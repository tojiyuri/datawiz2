/**
 * Ollama provider — local LLM via http://localhost:11434
 *
 * Setup for the user:
 *   1. Install Ollama: https://ollama.com/download
 *   2. Pull a tool-use-capable model:
 *        ollama pull llama3.1:8b      (small, fast, OK quality)
 *        ollama pull qwen2.5:14b      (recommended — good tool use)
 *        ollama pull qwen2.5:32b      (best quality, needs 32GB+ RAM)
 *   3. In .env:
 *        LLM_PROVIDER=ollama
 *        OLLAMA_MODEL=qwen2.5:14b
 *        OLLAMA_HOST=http://localhost:11434  (default)
 *
 * Ollama supports OpenAI-compatible tool calling on recent models. We use
 * the native Ollama /api/chat endpoint (not the OpenAI-compat one) because
 * it's more reliable across model variants.
 *
 * IMPORTANT: Local models are noticeably less reliable than Claude at
 * structured tool use. Field name hallucinations and malformed JSON happen.
 * The engine's validation layer catches most of these — invalid field names
 * get filtered out before being applied to the chart spec.
 */

let axios = null;
let axiosLoadAttempted = false;

function getAxios() {
  if (axiosLoadAttempted) return axios;
  axiosLoadAttempted = true;
  try {
    axios = require('axios');
    return axios;
  } catch (err) {
    console.warn('[Wiz/ollama] axios not installed (should be — it ships with Data Wiz)');
    return null;
  }
}

const HOST = () => process.env.OLLAMA_HOST || 'http://localhost:11434';
const MODEL = () => process.env.OLLAMA_MODEL || 'qwen2.5:14b';

let availabilityCache = { checked: 0, available: false };
const AVAILABILITY_TTL = 30 * 1000; // re-probe every 30 seconds

async function probeAvailability() {
  const ax = getAxios();
  if (!ax) return false;
  try {
    // Ollama's health: /api/tags lists available models. Fast call.
    const r = await ax.get(`${HOST()}/api/tags`, { timeout: 1500 });
    return Array.isArray(r.data?.models);
  } catch {
    return false;
  }
}

async function isAvailableAsync() {
  const now = Date.now();
  if (now - availabilityCache.checked < AVAILABILITY_TTL) {
    return availabilityCache.available;
  }
  const ok = await probeAvailability();
  availabilityCache = { checked: now, available: ok };
  return ok;
}

// Synchronous fallback — returns last known state without re-probing.
// Used when the engine needs a quick yes/no without making the call wait.
function isAvailable() {
  // If we've never probed, kick off a background probe — first real call will
  // wait, but subsequent calls won't pay the latency.
  if (availabilityCache.checked === 0) {
    isAvailableAsync().catch(() => {});
  }
  return availabilityCache.available;
}

function describe() {
  return {
    name: 'ollama',
    available: isAvailable(),
    model: MODEL(),
    location: 'local',
    host: HOST(),
  };
}

/**
 * Convert our generic tool definition (Anthropic-shaped) to Ollama's expected
 * format. Ollama accepts the OpenAI tool format: { type: 'function', function: {...} }
 */
function convertTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * Send a tool-use request. Same return shape as anthropic.complete.
 *
 * Ollama tool-call response shape (roughly):
 *   { message: { content: "...", tool_calls: [{ function: { name, arguments } }] } }
 */
async function complete({ systemPrompt, userContent, tools }) {
  const ax = getAxios();
  if (!ax) return { error: 'axios unavailable' };

  if (!(await isAvailableAsync())) {
    return { error: `Ollama not reachable at ${HOST()}. Is it running? Try: ollama serve` };
  }

  const model = MODEL();
  const start = Date.now();

  try {
    const response = await ax.post(
      `${HOST()}/api/chat`,
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        tools: convertTools(tools),
        stream: false,
        options: {
          temperature: 0.2,         // low — we want deterministic tool calls
          num_predict: 2500,
        },
      },
      { timeout: 120 * 1000 }       // local models can be slow; generous timeout
    );

    const message = response.data?.message;
    const toolCalls = message?.tool_calls || [];

    // Ollama may return either 'tool_calls' (proper) or embed JSON in 'content'
    // (less reliable models). We handle both.
    let toolName = null;
    let toolInput = null;

    if (toolCalls.length > 0) {
      const first = toolCalls[0];
      toolName = first.function?.name;
      const args = first.function?.arguments;
      // Some Ollama builds return arguments as object, others as string
      if (typeof args === 'string') {
        try { toolInput = JSON.parse(args); }
        catch { toolInput = null; }
      } else {
        toolInput = args || null;
      }
    } else if (message?.content) {
      // Fallback: try to extract JSON from the content
      const extracted = extractToolCallFromContent(message.content, tools);
      if (extracted) {
        toolName = extracted.name;
        toolInput = extracted.input;
      }
    }

    return {
      toolName,
      toolInput,
      textPreamble: message?.content || null,
      model,
      latencyMs: Date.now() - start,
      usage: { input_tokens: response.data?.prompt_eval_count, output_tokens: response.data?.eval_count },
    };
  } catch (err) {
    const detail = err.response?.data?.error || err.message;
    return { error: detail, model, latencyMs: Date.now() - start };
  }
}

/**
 * When a model returns prose with embedded JSON instead of using the tool API
 * (older or smaller models do this), try to recover. Looks for the most
 * plausible JSON block + matches it against the available tool schemas.
 */
function extractToolCallFromContent(content, tools) {
  if (!content) return null;
  // Find the largest balanced { ... } block
  const matches = [];
  let depth = 0, start = -1;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (content[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        matches.push(content.slice(start, i + 1));
        start = -1;
      }
    }
  }
  // Try each candidate, biggest first (likely the actual response)
  for (const candidate of matches.sort((a, b) => b.length - a.length)) {
    try {
      const parsed = JSON.parse(candidate);
      // Check if it looks like a tool call: has a 'name' field matching one of our tools
      if (parsed.name && tools.find((t) => t.name === parsed.name)) {
        return { name: parsed.name, input: parsed.parameters || parsed.arguments || parsed.input || parsed };
      }
      // Or: the parsed object looks like it would fit one of the tools' input schemas
      for (const tool of tools) {
        const required = tool.input_schema?.required || [];
        if (required.length && required.every((k) => k in parsed)) {
          return { name: tool.name, input: parsed };
        }
      }
    } catch {
      // not valid JSON, skip
    }
  }
  return null;
}

module.exports = { complete, isAvailable, isAvailableAsync, describe };
