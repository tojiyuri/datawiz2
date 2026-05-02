/**
 * Anthropic provider — Claude via official SDK.
 *
 * Uses structured tool use. Returns a normalized response shape that the
 * engine can compare with other providers.
 *
 * Env: ANTHROPIC_API_KEY (required), CLAUDE_MODEL (optional)
 */

let anthropicClient = null;
let sdkLoadAttempted = false;

function getClient() {
  if (sdkLoadAttempted) return anthropicClient;
  sdkLoadAttempted = true;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const Anthropic = require('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropicClient;
  } catch (err) {
    console.warn('[Wiz/anthropic] @anthropic-ai/sdk not installed.');
    return null;
  }
}

function isAvailable() {
  return getClient() !== null;
}

function describe() {
  return {
    name: 'anthropic',
    available: isAvailable(),
    model: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    location: 'cloud',
  };
}

/**
 * Send a structured tool-use request. Returns:
 *   { toolName, toolInput, textPreamble, model, latencyMs, usage }
 *
 * Or { error } if the call failed. The engine handles error display.
 */
async function complete({ systemPrompt, userContent, tools }) {
  const client = getClient();
  if (!client) return { error: 'Anthropic client unavailable' };

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  const start = Date.now();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 2500,
      system: systemPrompt,
      tools,
      tool_choice: { type: 'auto' },
      messages: [{ role: 'user', content: userContent }],
    });

    const toolBlock = response.content?.find((b) => b.type === 'tool_use');
    const textBlock = response.content?.find((b) => b.type === 'text');

    return {
      toolName: toolBlock?.name || null,
      toolInput: toolBlock?.input || null,
      textPreamble: textBlock?.text || null,
      model,
      latencyMs: Date.now() - start,
      usage: response.usage,
    };
  } catch (err) {
    return { error: err.message, model, latencyMs: Date.now() - start };
  }
}

module.exports = { complete, isAvailable, describe };
