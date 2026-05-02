/**
 * LLM Insight Explainer
 *
 * Takes statistical findings from dashboardInsights.js (outliers, trends,
 * correlations) and turns them into human-readable narratives.
 *
 * Heuristic version: "Outlier detected: Q3 Sales 23K (2.4σ above mean)"
 * LLM version:       "Q3 sales spiked unusually high — about 24% above the
 *                     yearly average. Worth investigating whether a campaign
 *                     or seasonal effect drove this."
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
    return null;
  }
}

const SYSTEM_PROMPT = `You are Wiz, an analyst writing brief insight cards for a business dashboard.

Given a statistical finding (outlier, trend, correlation, concentration), write a 1-2 sentence narrative that:
- States the finding plainly, in plain English
- Hints at what it might mean or why it matters
- Avoids jargon (no "standard deviation", "z-score", "coefficient")
- Uses concrete numbers from the finding
- Tone: smart colleague pointing something out, not a textbook

Output ONLY the narrative text. No preamble, no JSON, no quotes around it.`;

async function explainFinding(finding, context = {}) {
  const client = getClient();
  if (!client) return null;

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

  const prompt = `FINDING TYPE: ${finding.type}
CHART: ${context.chartTitle || 'Untitled'}
MEASURE: ${context.measure || 'value'}
DIMENSION: ${context.dimension || 'category'}

DATA:
${JSON.stringify(finding, null, 2)}

Write a 1-2 sentence narrative.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content?.[0]?.text?.trim() || null;
  } catch (err) {
    console.error('[LLM Insights] Explanation error:', err.message);
    return null;
  }
}

async function enrichInsights(insights, contextByTileId = {}) {
  const client = getClient();
  if (!client) return insights;

  // Run all explanations in parallel — each is a small, fast call
  const enriched = await Promise.all(
    insights.map(async (ins) => {
      const ctx = contextByTileId[ins.tileId] || {};
      const narrative = await explainFinding(ins, ctx);
      if (!narrative) return ins;
      return {
        ...ins,
        narrative,
        originalSummary: ins.summary,
        summary: narrative,
        poweredBy: 'llm',
      };
    })
  );

  return enriched;
}

function isLLMAvailable() {
  return getClient() !== null;
}

module.exports = { explainFinding, enrichInsights, isLLMAvailable };
