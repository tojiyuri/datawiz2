/**
 * Groq provider — Llama 3.3 70B (and other open models) via Groq's
 * OpenAI-compatible API.
 *
 * Why Groq: their free tier is generous (~30 req/min, no daily cap that
 * matters for a demo) and Llama 3.3 70B is genuinely close to Claude/GPT-4
 * quality for structured tool-use tasks like ours. Most importantly — no
 * credit card required to sign up.
 *
 * Env:
 *   GROQ_API_KEY (required)
 *   GROQ_MODEL   (optional, defaults to llama-3.3-70b-versatile)
 *
 * Returns the same normalized shape as the other providers:
 *   { toolName, toolInput, textPreamble, model, latencyMs, usage }
 *   or { error } on failure.
 */

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

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

/**
 * Anthropic-style tools have `input_schema`; OpenAI/Groq use `parameters`
 * inside a `function` wrapper. Convert in place — same JSON Schema, just
 * a different envelope.
 */
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

/**
 * Send a structured tool-use request. Mirrors the contract of
 * llmProviders/anthropic.js so the engine treats them as drop-in equivalents.
 */
async function complete({ systemPrompt, userContent, tools }) {
  if (!isAvailable()) return { error: 'Groq client unavailable (GROQ_API_KEY not set)' };

  const model = process.env.GROQ_MODEL || DEFAULT_MODEL;
  const start = Date.now();

  // Use native fetch (Node 18+). The repo pins Node >=20 in package.json.
  let response;
  try {
    response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 2500,
        // OpenAI-style: system prompt is a separate role in messages
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        tools: adaptTools(tools),
        tool_choice: 'auto',
      }),
    });
  } catch (err) {
    return { error: `Groq fetch failed: ${err.message}`, model, latencyMs: Date.now() - start };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return {
      error: `Groq HTTP ${response.status}: ${text.slice(0, 200)}`,
      model,
      latencyMs: Date.now() - start,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (err) {
    return { error: `Groq returned non-JSON: ${err.message}`, model, latencyMs: Date.now() - start };
  }

  const choice = body?.choices?.[0]?.message;
  if (!choice) {
    return { error: 'Groq response missing choices[0].message', model, latencyMs: Date.now() - start };
  }

  // Tool call (OpenAI-style: choice.tool_calls[0].function.{name, arguments})
  // The arguments come back as a JSON-encoded string — parse to an object.
  const toolCall = choice.tool_calls?.[0];
  let toolName = null, toolInput = null;
  if (toolCall) {
    toolName = toolCall.function?.name || null;
    const rawArgs = toolCall.function?.arguments;
    if (typeof rawArgs === 'string' && rawArgs.length > 0) {
      try {
        toolInput = JSON.parse(rawArgs);
      } catch {
        // Some models return malformed JSON for tool args. Log and surface
        // as if no tool was called — engine will fall back to heuristics.
        console.warn('[Wiz/groq] tool_call.arguments was not valid JSON:', rawArgs.slice(0, 200));
        toolName = null;
      }
    } else if (rawArgs && typeof rawArgs === 'object') {
      // Defensive: some clients return parsed objects directly
      toolInput = rawArgs;
    }
  }

  return {
    toolName,
    toolInput,
    textPreamble: choice.content || null,
    model,
    latencyMs: Date.now() - start,
    usage: body.usage,
  };
}

module.exports = { complete, isAvailable, describe };
