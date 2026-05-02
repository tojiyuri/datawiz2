/**
 * Groq provider — Llama 3.x via Groq's OpenAI-compatible API.
 *
 * Why Groq: free tier, fast, no card needed, and Llama-3.x is genuinely
 * usable for structured tool calls. The catch — Groq is strict about
 * tool-call schema validation, and Llama is fuzzier about staying inside
 * enums than Claude/GPT-4 are. The two together cause "tool call validation
 * failed" 400s on calls that are *almost* valid.
 *
 * This file layers in resilience to compensate:
 *
 *   1. ENUM COERCION on the response side. When Groq returns HTTP 400 with
 *      a tool-validation error, we parse the rejected tool args from the
 *      error payload, coerce common Llama enum mistakes (e.g. "category"
 *      → "categorical", "time" → "date"), and return the coerced spec as
 *      if it had succeeded. The schema is loose enough at the engine
 *      layer that minor coercions don't change semantics.
 *
 *   2. RATE-LIMIT FALLBACK. HTTP 429 is reported back as a *non-error*
 *      with a `rateLimited: true` flag, so the conversation engine knows
 *      to fall through to its heuristic provider rather than show the
 *      user a "snag" message.
 *
 *   3. TRANSIENT RETRY. 5xx errors get one retry after a short delay.
 *      Doesn't help with 400/401/429.
 *
 * Env:
 *   GROQ_API_KEY (required)
 *   GROQ_MODEL   (optional, defaults to llama-3.1-8b-instant — small,
 *                 fast, generous free-tier limits)
 *
 * Returns the same normalized shape as the other providers:
 *   { toolName, toolInput, textPreamble, model, latencyMs, usage }
 *   { error, ... }                                           (hard failure)
 *   { rateLimited: true, model, latencyMs }                  (let engine fall through)
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.1-8b-instant';

// ─── ENUM COERCION ───────────────────────────────────────────────────────────
//
// Llama 8b on Groq sometimes outputs values that are obvious-by-meaning but
// not in our enum. We have three enums where this happens; the rest of the
// schema is permissive enough that strays don't reach validation.

const TYPE_COERCIONS = {
  category: 'categorical',
  cat: 'categorical',
  text: 'categorical',
  string: 'categorical',
  str: 'categorical',
  enum: 'categorical',
  time: 'date',
  datetime: 'date',
  timestamp: 'date',
  number: 'numeric',
  num: 'numeric',
  int: 'numeric',
  integer: 'numeric',
  float: 'numeric',
  decimal: 'numeric',
  measure: 'numeric',
};

const AGG_COERCIONS = {
  average: 'avg',
  mean: 'avg',
  total: 'sum',
  distinct: 'countd',
  distinct_count: 'countd',
  unique: 'countd',
  uniques: 'countd',
  cnt: 'count',
};

const CHART_COERCIONS = {
  barchart: 'bar',
  bar_chart: 'bar',
  linechart: 'line',
  line_chart: 'line',
  scatterplot: 'scatter',
  scatter_plot: 'scatter',
  histo: 'histogram',
  hist: 'histogram',
  piechart: 'pie',
  pie_chart: 'pie',
  donutchart: 'donut',
  doughnut: 'donut',
  treemapchart: 'treemap',
  treemap_chart: 'treemap',
  heat_map: 'heatmap',
};

function coerce(map, value) {
  if (typeof value !== 'string') return value;
  const lower = value.toLowerCase().trim();
  return map[lower] || value;
}

/**
 * Walk a tool_input object and apply enum coercions in place. Returns the
 * (possibly modified) object. Tolerant of missing/null fields.
 */
function coerceToolInput(input) {
  if (!input || typeof input !== 'object') return input;

  if (input.chartType) input.chartType = coerce(CHART_COERCIONS, input.chartType);

  for (const shelf of ['columns', 'rows']) {
    const arr = input[shelf];
    if (!Array.isArray(arr)) continue;
    for (const f of arr) {
      if (!f || typeof f !== 'object') continue;
      if (f.type) f.type = coerce(TYPE_COERCIONS, f.type);
      if (f.aggregation) f.aggregation = coerce(AGG_COERCIONS, f.aggregation);
    }
  }

  if (input.size && typeof input.size === 'object' && input.size.aggregation) {
    input.size.aggregation = coerce(AGG_COERCIONS, input.size.aggregation);
  }

  return input;
}

// ─── ERROR-PAYLOAD RECOVERY ──────────────────────────────────────────────────
//
// When Groq returns HTTP 400 with "tool call validation failed", the rejected
// tool call is in the error response body's `failed_generation` field, in one
// of two shapes (string or object). We extract, parse, coerce, and pretend
// the call succeeded.

function extractFailedGeneration(errorBody) {
  try {
    const fg = errorBody?.error?.failed_generation;
    if (!fg) return null;
    if (typeof fg === 'object') return fg;
    if (typeof fg === 'string') {
      // Sometimes the model wraps in markdown ```json ... ```
      const cleaned = fg
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
      return JSON.parse(cleaned);
    }
  } catch {
    return null;
  }
  return null;
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

function isAvailable() {
  return !!process.env.GROQ_API_KEY;
}

function describe() {
  return {
    name: 'groq',
    available: isAvailable(),
    model: process.env.GROQ_MODEL || DEFAULT_MODEL,
    location: 'cloud',
  };
}

function adaptTools(anthropicTools) {
  return anthropicTools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function callGroqOnce({ body }) {
  let response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { networkError: err.message };
  }

  let parsed = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = { error: { message: 'non-JSON response' } };
  }

  return { status: response.status, ok: response.ok, body: parsed };
}

async function complete({ systemPrompt, userContent, tools }) {
  if (!isAvailable()) return { error: 'Groq client unavailable (GROQ_API_KEY not set)' };

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const start = Date.now();

  const body = {
    model,
    max_tokens: 2500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    tools: adaptTools(tools),
    tool_choice: 'auto',
  };

  // First attempt
  let result = await callGroqOnce({ body });

  // ─ Retry once on 5xx (transient) ──────────────────────────────────────────
  if (result.status >= 500 && result.status < 600) {
    await sleep(600);
    result = await callGroqOnce({ body });
  }

  // ─ Network error → hard fail ──────────────────────────────────────────────
  if (result.networkError) {
    return { error: `Groq fetch failed: ${result.networkError}`, model, latencyMs: Date.now() - start };
  }

  // ─ Rate limit → graceful fall-through ─────────────────────────────────────
  // Reporting `rateLimited: true` (not `error`) lets the engine fall back to
  // its heuristic provider instead of showing a "snag" message to the user.
  if (result.status === 429) {
    console.warn('[Wiz/groq] rate limited, falling back to heuristic');
    return { rateLimited: true, model, latencyMs: Date.now() - start };
  }

  // ─ 400 with tool-validation error → recover via coercion ──────────────────
  if (result.status === 400) {
    const failed = extractFailedGeneration(result.body);
    if (failed && typeof failed === 'object') {
      const coerced = coerceToolInput(failed);
      console.warn('[Wiz/groq] recovered from validation 400 via coercion');
      return {
        toolName: 'update_chart',
        toolInput: coerced,
        textPreamble: null,
        model,
        latencyMs: Date.now() - start,
        usage: result.body?.usage,
        recovered: true,
      };
    }
    const msg = result.body?.error?.message || JSON.stringify(result.body).slice(0, 200);
    return { error: `Groq HTTP 400: ${msg}`, model, latencyMs: Date.now() - start };
  }

  // ─ Other non-OK statuses → hard error ─────────────────────────────────────
  if (!result.ok) {
    const msg = result.body?.error?.message || `HTTP ${result.status}`;
    return { error: `Groq HTTP ${result.status}: ${msg.slice(0, 200)}`, model, latencyMs: Date.now() - start };
  }

  // ─ Happy path ─────────────────────────────────────────────────────────────
  const choice = result.body?.choices?.[0]?.message;
  if (!choice) {
    return { error: 'Groq response missing choices[0].message', model, latencyMs: Date.now() - start };
  }

  const toolCall = choice.tool_calls?.[0];
  let toolName = null, toolInput = null;
  if (toolCall) {
    toolName = toolCall.function?.name || null;
    const rawArgs = toolCall.function?.arguments;
    if (typeof rawArgs === 'string' && rawArgs.length > 0) {
      try {
        toolInput = JSON.parse(rawArgs);
      } catch {
        console.warn('[Wiz/groq] tool_call.arguments was not valid JSON:', rawArgs.slice(0, 200));
        toolName = null;
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      toolInput = rawArgs;
    }
    // Always coerce on success too — defends against edge cases server-side
    // validation might miss in newer model versions.
    if (toolInput) toolInput = coerceToolInput(toolInput);
  }

  return {
    toolName,
    toolInput,
    textPreamble: choice.content || null,
    model,
    latencyMs: Date.now() - start,
    usage: result.body?.usage,
  };
}

module.exports = { complete, isAvailable, describe };
