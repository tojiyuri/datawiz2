/**
 * LLM Calc Field Suggester
 *
 * Heuristic version: regex matches "Sales" + "Cost" → suggest Profit.
 * LLM version: understands semantically. Given columns like
 * [Premium_Paid, Claims_Paid, Policy_Holders] for an insurance dataset,
 * it can suggest "Loss Ratio = Claims_Paid / Premium_Paid" — a domain
 * KPI no regex would catch.
 */

const heuristicSuggester = require('./calcFieldSuggester');

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

const SYSTEM_PROMPT = `You are an analytics expert recommending calculated fields for a dataset.

Given a dataset's column list, suggest 3-6 useful calculated fields that would help business analysis. Focus on KPIs and ratios that make sense for the domain you can infer (retail, finance, healthcare, marketing, education, etc.).

Each suggestion must use Tableau-style formula syntax:
- Field references: [Field Name]
- Operators: + - * / ()
- Aggregations: SUM(), AVG(), COUNT()
- Conditionals: IF [X] > 100 THEN "High" ELSE "Low" END

OUTPUT FORMAT (valid JSON array, nothing else):
[
  {
    "name": "Profit Margin %",
    "formula": "([Sales] - [Cost]) / [Sales] * 100",
    "rationale": "Standard retail KPI showing profitability per sale.",
    "confidence": 0.95
  },
  ...
]

RULES:
- Field names in formulas MUST match the schema exactly (case-sensitive).
- Only suggest fields where ALL referenced columns actually exist in the schema.
- Confidence 0.9+ : universally useful KPI for this domain.
- Confidence 0.7-0.9: likely useful, common pattern.
- Confidence 0.5-0.7: speculative but reasonable.
- Skip suggestions below 0.5.
- Don't suggest trivial things like "Total = SUM([X])" — that's already available.
- Prefer rate/ratio/percentage calcs over additive ones.
- Maximum 6 suggestions, ranked by usefulness.`;

async function suggest(dataset) {
  const client = getClient();

  if (!client) {
    const heuristic = heuristicSuggester.suggestCalcFields(dataset);
    return heuristic.map((s) => ({ ...s, poweredBy: 'heuristic' }));
  }

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

  const schema = (dataset.columns || [])
    .map((c) => `  - ${c.name} (${c.type || c.dataType || 'unknown'})`)
    .join('\n');

  const prompt = `DATASET: ${dataset.name || 'unnamed'}
ROWS: ${dataset.rowCount || '?'}

COLUMNS:
${schema}

Suggest calculated fields. Output ONLY the JSON array.`;

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content?.[0]?.text?.trim() || '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

    let suggestions;
    try {
      suggestions = JSON.parse(cleaned);
    } catch (e) {
      const match = cleaned.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('No JSON array in response');
      suggestions = JSON.parse(match[0]);
    }

    if (!Array.isArray(suggestions)) {
      throw new Error('Response is not an array');
    }

    // Validate field references
    const validFields = new Set((dataset.columns || []).map((c) => c.name));
    const validated = suggestions
      .filter((s) => s && s.name && s.formula)
      .map((s) => {
        // Extract [FieldName] references
        const refs = (s.formula.match(/\[([^\]]+)\]/g) || []).map((m) => m.slice(1, -1));
        const allValid = refs.every((r) => validFields.has(r));
        return { ...s, poweredBy: 'llm', _valid: allValid };
      })
      .filter((s) => s._valid)
      .map((s) => {
        delete s._valid;
        return s;
      });

    return validated;
  } catch (err) {
    console.error('[LLM Calc Suggester] Error, falling back to heuristic:', err.message);
    const heuristic = heuristicSuggester.suggestCalcFields(dataset);
    return heuristic.map((s) => ({ ...s, poweredBy: 'heuristic', fallbackReason: err.message }));
  }
}

function isLLMAvailable() {
  return getClient() !== null;
}

module.exports = { suggest, isLLMAvailable };
