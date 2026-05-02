/**
 * LLM Conversation Engine — multi-provider with structured tool use.
 *
 * Routes Ask Wiz requests to one of four providers, selected via LLM_PROVIDER:
 *   - anthropic  (best quality — Claude, requires ANTHROPIC_API_KEY)
 *   - groq       (free tier, fast — Llama 3.3 70B, requires GROQ_API_KEY)
 *   - ollama     (local — runs on the user's machine, requires Ollama installed)
 *   - none       (heuristic-only — no LLM)
 *
 * The structured tool-use schema is shared across providers. Each provider
 * adapts the call format to its API. The engine handles spec validation,
 * intent detection, and fallback behaviour identically regardless of provider.
 *
 * Two tools:
 *   - update_chart : returns a complete spec covering all v6.8 features
 *   - ask_clarifying_question : returns a follow-up when intent is unclear
 *
 * Local models are noticeably less reliable at structured output than Claude.
 * The validation layer below filters out hallucinated field names and
 * malformed inputs before they hit the chart spec.
 */

const heuristicEngine = require('./conversationEngine');
const anthropicProvider = require('./llmProviders/anthropic');
const groqProvider = require('./llmProviders/groq');
const ollamaProvider = require('./llmProviders/ollama');

function selectedProvider() {
  const choice = (process.env.LLM_PROVIDER || 'auto').toLowerCase();
  if (choice === 'none' || choice === 'heuristic') return null;
  if (choice === 'ollama') return ollamaProvider;
  if (choice === 'groq') return groqProvider;
  if (choice === 'anthropic' || choice === 'claude') return anthropicProvider;

  // 'auto' (default): prefer paid, then free cloud, then local, then heuristic.
  // Order: anthropic > groq > ollama > null. If you want to force a different
  // provider, set LLM_PROVIDER explicitly.
  if (anthropicProvider.isAvailable()) return anthropicProvider;
  if (groqProvider.isAvailable()) return groqProvider;
  if (ollamaProvider.isAvailable()) return ollamaProvider;
  return null;
}

function getClient() {
  return selectedProvider();
}

// ─── TOOL DEFINITIONS ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'update_chart',
    description: 'Update the chart specification based on the user\'s request. Use this for ALL chart-building actions: creating, modifying, filtering, calculating, etc. Provide the COMPLETE new spec — not a delta — so any field you omit will be cleared.',
    input_schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'Friendly 1-2 sentence reply to the user explaining what you did. Use their vocabulary. Examples: "Plotted sales by region — looks like East is leading.", "Filtered to your top 5 products."',
        },
        chartType: {
          type: 'string',
          enum: ['bar', 'line', 'pie', 'scatter', 'table', 'heatmap', 'area', 'treemap', 'funnel', 'gauge', 'kpi', 'donut', 'histogram'],
          description: 'Chart type to render. Default to "bar" for category comparisons, "line" for time series, "scatter" for correlation, "pie" for parts-of-whole.',
        },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'EXACT column name from the dataset schema. Case-sensitive.' },
              type: { type: 'string', enum: ['numeric', 'categorical', 'date'] },
              aggregation: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'median', 'countd'], description: 'Required for numeric fields, omit for categorical/date.' },
            },
            required: ['name', 'type'],
          },
          description: 'Fields on the columns shelf — typically the X axis or measures.',
        },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['numeric', 'categorical', 'date'] },
              aggregation: { type: 'string', enum: ['sum', 'avg', 'count', 'min', 'max', 'median', 'countd'] },
            },
            required: ['name', 'type'],
          },
          description: 'Fields on the rows shelf — typically Y axis or measures for horizontal bars.',
        },
        color: {
          type: ['object', 'null'],
          properties: { name: { type: 'string' } },
          description: 'Field used for color encoding (a categorical field that becomes a stacked/grouped split).',
        },
        size: {
          type: ['object', 'null'],
          properties: { name: { type: 'string' }, aggregation: { type: 'string' } },
          description: 'Numeric field for size encoding (mainly scatter and bubble charts).',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              op: { type: 'string', enum: ['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in', 'contains', 'top_n', 'between'] },
              value: { description: 'Comparison value. For top_n, an integer. For between, [min, max]. For in/not_in, an array.' },
            },
            required: ['field', 'op'],
          },
          description: 'Filter conditions applied to the dataset before aggregation.',
        },
        calculatedFields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'New column name.' },
              formula: { type: 'string', description: 'Tableau-style formula. Examples: "[Sales] - [Cost]", "([Sales] - [Cost]) / [Sales] * 100", "IF [Region] = \\"East\\" THEN [Sales] ELSE 0 END"' },
            },
            required: ['name', 'formula'],
          },
          description: 'Custom row-level or aggregate calculations.',
        },
        bins: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              source: { type: 'string', description: 'Numeric column to bin.' },
              strategy: { type: 'string', enum: ['equal-width', 'quantile', 'custom'] },
              count: { type: 'integer' },
              edges: { type: 'array', items: { type: 'number' } },
              labels: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'source', 'strategy'],
          },
          description: 'Bucket continuous numeric values. Use for "group ages into ranges", "tier customers by spend", etc.',
        },
        sets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              source: { type: 'string' },
              mode: { type: 'string', enum: ['manual', 'top', 'bottom', 'condition'] },
              values: { type: 'array', items: { type: 'string' } },
              count: { type: 'integer' },
              rankBy: { type: 'string' },
              aggregation: { type: 'string' },
              condition: {
                type: 'object',
                properties: { op: { type: 'string' }, value: {} },
              },
            },
            required: ['name', 'source', 'mode'],
          },
          description: 'In/out groups. Use for "highlight top 10 customers", "show only big sales", "compare a custom group vs everyone else".',
        },
        lods: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              expression: { type: 'string', description: 'Format: {FIXED [Dim1], [Dim2]: AGG([Field])}. Example: {FIXED [Region]: SUM([Sales])}' },
            },
            required: ['name', 'expression'],
          },
          description: 'Level-of-detail aggregations — broadcast a fixed-granularity aggregate to every row. Use for "share of region", "running average per category".',
        },
        parameters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              dataType: { type: 'string', enum: ['number', 'string', 'boolean', 'date'] },
              value: {},
              min: { type: 'number' },
              max: { type: 'number' },
              step: { type: 'number' },
              control: { type: 'string', enum: ['slider', 'dropdown', 'input', 'toggle'] },
            },
            required: ['name', 'dataType'],
          },
          description: 'User-controllable variables. Reference in formulas as @ParamName.',
        },
        tableCalcs: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              expression: { type: 'string', description: 'e.g. RUNNING_SUM([Sales]), MOVING_AVG([Sales], 3), RANK([Sales], "desc"), PERCENT_OF_TOTAL([Sales])' },
              partitionBy: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'expression'],
          },
          description: 'Window functions over aggregated chart data: running totals, moving averages, ranks, lookups.',
        },
        hierarchies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              levels: { type: 'array', items: { type: 'string' } },
            },
            required: ['name', 'levels'],
          },
          description: 'Drill-down chains, e.g. {name: "Geography", levels: ["Country", "State", "City"]}.',
        },
        suggestions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two short follow-up prompts the user might want to try next, given the new state.',
        },
      },
      required: ['message', 'chartType'],
    },
  },
  {
    name: 'ask_clarifying_question',
    description: 'Ask the user to clarify when the request is genuinely ambiguous and there\'s no reasonable default. Prefer making a choice and explaining it over asking — only use this when it\'s really unclear.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Friendly clarifying question.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '2-4 specific options the user can pick from to disambiguate.',
        },
      },
      required: ['question'],
    },
  },
];

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Wiz, a friendly and capable data visualization assistant inside Data Wiz, a Tableau-class BI tool. You help users build charts and dashboards through natural conversation.

PERSONALITY:
- Friendly, brief, confident. You sound like a competent colleague, not a chatbot.
- Use the user's vocabulary. If they say "revenue" and the column is "Sales", just call it Sales in your reply but match their intent.
- Never apologize for being an AI. Never use phrases like "I'd be happy to" or "Certainly!" Just do the thing.
- Celebrate small wins ("Top 5 incoming!") but don't overdo it.

YOUR TOOLS:
You have one main tool: update_chart. ALMOST ALWAYS use this — it returns a complete chart spec the system applies directly. Use ask_clarifying_question only when truly ambiguous (e.g. "show me the data" with no hint of what to plot).

WHEN UPDATING THE CHART:
- The spec you return REPLACES the current spec entirely. Always include all fields you want kept, not just the changes. If the user says "add profit", include the existing fields PLUS profit in your response.
- Field names MUST be EXACT matches to the schema (case-sensitive). If the user says "revenue" and the schema has "Sales", use "Sales".
- Numeric fields on shelves need an aggregation (default to "sum" unless specified).
- For time series: date in rows, measure in columns, chartType "line".
- For top-N: add a filter with op "top_n" and integer value.
- For "show only X": add a filter with op "in" or "=".
- For "what's my [percentage / share / ratio]": consider an LOD calc.
- For "running total" / "moving avg" / "rank": use tableCalcs.
- Suggest 2 thoughtful follow-ups that build on what you just did.

WHEN TO USE ADVANCED FEATURES:
- bins: "group ages into 5 ranges", "bucket sales by tier"
- sets: "highlight top 10 customers", "anyone with sales > 1000"
- lods: "share of total per region", "% of category", "{FIXED [X]: SUM([Y])}"
- parameters: "let me adjust the threshold", "make this configurable"
- tableCalcs: running totals, moving averages, ranks, % of total, period-over-period
- hierarchies: "drill from country to state to city"

When the user references something abstractly ("growth", "performance", "trend"), pick a reasonable measure and dimension based on the schema and explain your choice in the message.`;

// ─── PROMPT BUILDER ──────────────────────────────────────────────────────────

function buildUserContent({ message, currentSpec, dataset, history }) {
  const schema = (dataset?.columns || []).map((c) => {
    const stats = [];
    if (c.uniqueCount != null) stats.push(`${c.uniqueCount} unique`);
    if (c.type === 'numeric' && c.stats?.min != null && c.stats?.max != null) {
      stats.push(`range ${c.stats.min}–${c.stats.max}`);
    }
    const sample = c.sampleValues?.length ? ` examples: ${c.sampleValues.slice(0, 3).join(', ')}` : '';
    return `  - ${c.name} (${c.type || 'unknown'}${stats.length ? `, ${stats.join(', ')}` : ''})${sample}`;
  }).join('\n');

  const historyBlock = (history || []).slice(-6).map((m) =>
    `${m.role === 'user' ? 'User' : 'Wiz'}: ${m.content || m.text || ''}`
  ).join('\n');

  return `DATASET: ${dataset?.name || 'unknown'} (${dataset?.rowCount || '?'} rows)

COLUMNS:
${schema}

CURRENT SPEC:
${currentSpec && Object.keys(currentSpec).length ? JSON.stringify(currentSpec, null, 2) : '(blank canvas — nothing built yet)'}

CONVERSATION HISTORY:
${historyBlock || '(this is the first turn)'}

USER MESSAGE: "${message}"`;
}

// ─── MAIN ENTRYPOINT ─────────────────────────────────────────────────────────

async function converse({ message, currentSpec, datasetId, history, dataset }) {
  const provider = selectedProvider();

  if (!provider) {
    const result = heuristicEngine.converse({ message, currentSpec, analysis: dataset });
    return { ...result, poweredBy: 'heuristic', llmAvailable: false };
  }

  const userContent = buildUserContent({ message, currentSpec, dataset, history });

  const response = await provider.complete({
    systemPrompt: SYSTEM_PROMPT,
    userContent,
    tools: TOOLS,
  });

  // Provider returned `rateLimited: true` (Groq free-tier TPM exceeded, or
  // similar). Rather than show a "snag" message to the user, gracefully
  // fall through to the heuristic engine so the conversation still works.
  if (response.rateLimited) {
    const fallback = heuristicEngine.converse({ message, currentSpec, analysis: dataset });
    return {
      ...fallback,
      poweredBy: 'heuristic',
      llmAvailable: true,
      llmRateLimited: true,
      latencyMs: response.latencyMs,
    };
  }

  // Provider call failed entirely (network, auth, model not loaded, etc.)
  if (response.error) {
    console.error(`[Wiz] ${provider.describe().name} call failed:`, response.error);
    return {
      intent: 'error',
      newSpec: null,
      reply: `I hit a snag (${provider.describe().name}). ${response.error.includes('Ollama not reachable') ? 'Is Ollama running? Try `ollama serve` in a terminal.' : 'Try again?'}`,
      confidence: 0,
      actions: [],
      suggestions: [],
      poweredBy: provider.describe().name,
      error: response.error,
      latencyMs: response.latencyMs,
    };
  }

  // Provider returned no tool call — model produced prose only
  if (!response.toolName) {
    return {
      intent: 'reply',
      newSpec: null,
      reply: response.textPreamble || "I had trouble understanding that. Try rephrasing?",
      confidence: 0.5,
      actions: [],
      suggestions: [],
      poweredBy: provider.describe().name,
      model: response.model,
      latencyMs: response.latencyMs,
    };
  }

  // Clarifying question
  if (response.toolName === 'ask_clarifying_question') {
    const input = response.toolInput || {};
    return {
      intent: 'unclear',
      newSpec: null,
      reply: input.question || 'Could you give me more detail?',
      confidence: 0.4,
      actions: [],
      suggestions: input.options || [],
      poweredBy: provider.describe().name,
      model: response.model,
      latencyMs: response.latencyMs,
    };
  }

  // Chart update
  if (response.toolName === 'update_chart') {
    const input = response.toolInput || {};
    const validFields = new Set((dataset?.columns || []).map((c) => c.name));

    // Validate and clean — local models hallucinate field names more than Claude
    const cleanShelf = (shelf) => Array.isArray(shelf)
      ? shelf.filter((s) => s.name && validFields.has(s.name))
      : [];

    const cleanFilters = (filters) => Array.isArray(filters)
      ? filters.filter((f) => f.field && validFields.has(f.field))
      : [];

    const newSpec = {
      chartType: input.chartType || 'bar',
      columns: cleanShelf(input.columns),
      rows: cleanShelf(input.rows),
      color: input.color?.name && validFields.has(input.color.name) ? input.color : null,
      size: input.size?.name && validFields.has(input.size.name) ? input.size : null,
      filters: cleanFilters(input.filters),
      calculatedFields: Array.isArray(input.calculatedFields) ? input.calculatedFields : [],
      bins: Array.isArray(input.bins) ? input.bins : [],
      sets: Array.isArray(input.sets) ? input.sets : [],
      lods: Array.isArray(input.lods) ? input.lods : [],
      parameters: Array.isArray(input.parameters) ? input.parameters : [],
      tableCalcs: Array.isArray(input.tableCalcs) ? input.tableCalcs : [],
      hierarchies: Array.isArray(input.hierarchies) ? input.hierarchies : [],
    };

    const intent = detectIntent(currentSpec, newSpec);
    const actions = describeActions(currentSpec, newSpec);

    return {
      intent,
      newSpec,
      reply: input.message || 'Done.',
      confidence: provider.describe().name === 'ollama' ? 0.75 : 0.9,
      actions,
      suggestions: Array.isArray(input.suggestions) ? input.suggestions.slice(0, 3) : [],
      poweredBy: provider.describe().name,
      model: response.model,
      latencyMs: response.latencyMs,
      usage: response.usage,
    };
  }

  // Unknown tool name — defensive fallback
  return {
    intent: 'unclear',
    newSpec: null,
    reply: "I tried something I don't recognize. Mind rephrasing?",
    confidence: 0.3,
    actions: [],
    suggestions: [],
    poweredBy: provider.describe().name,
    model: response.model,
    latencyMs: response.latencyMs,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function detectIntent(oldSpec, newSpec) {
  if (!oldSpec || (!oldSpec.columns?.length && !oldSpec.rows?.length)) return 'create';
  if (oldSpec.chartType !== newSpec.chartType) return 'change_chart';
  const oldCols = (oldSpec.columns || []).length + (oldSpec.rows || []).length;
  const newCols = (newSpec.columns || []).length + (newSpec.rows || []).length;
  if (newCols > oldCols) return 'add_field';
  if (newCols < oldCols) return 'remove_field';
  if ((newSpec.filters || []).length !== (oldSpec.filters || []).length) return 'filter';
  if ((newSpec.calculatedFields || []).length !== (oldSpec.calculatedFields || []).length) return 'create_calc_field';
  if ((newSpec.lods || []).length !== (oldSpec.lods || []).length) return 'create_lod';
  if ((newSpec.tableCalcs || []).length !== (oldSpec.tableCalcs || []).length) return 'create_table_calc';
  return 'update';
}

function describeActions(oldSpec, newSpec) {
  const actions = [];
  const oldFields = new Set([...(oldSpec?.columns || []), ...(oldSpec?.rows || [])].map((f) => f.name));
  const newFields = new Set([...(newSpec.columns || []), ...(newSpec.rows || [])].map((f) => f.name));

  for (const f of newFields) if (!oldFields.has(f)) actions.push(`Added ${f}`);
  for (const f of oldFields) if (!newFields.has(f)) actions.push(`Removed ${f}`);

  if (oldSpec?.chartType !== newSpec.chartType) actions.push(`Switched to ${newSpec.chartType}`);

  const oldFilterCount = (oldSpec?.filters || []).length;
  const newFilterCount = (newSpec.filters || []).length;
  if (newFilterCount > oldFilterCount) actions.push('Added filter');
  if (newFilterCount < oldFilterCount) actions.push('Removed filter');

  if ((newSpec.calculatedFields || []).length > (oldSpec?.calculatedFields || []).length) {
    actions.push('Added calculated field');
  }
  if ((newSpec.lods || []).length > (oldSpec?.lods || []).length) actions.push('Added LOD');
  if ((newSpec.tableCalcs || []).length > (oldSpec?.tableCalcs || []).length) actions.push('Added table calc');
  if ((newSpec.bins || []).length > (oldSpec?.bins || []).length) actions.push('Added bin');
  if ((newSpec.sets || []).length > (oldSpec?.sets || []).length) actions.push('Added set');

  return actions.slice(0, 4);
}

function isLLMAvailable() {
  return selectedProvider() !== null;
}

/**
 * Describe the active provider so the UI can show "Live · Claude" or
 * "Live · Ollama (local)" or "Heuristic" in the status badge.
 */
function describeProvider() {
  const p = selectedProvider();
  if (!p) {
    return {
      name: 'heuristic',
      available: false,
      model: null,
      location: null,
    };
  }
  return p.describe();
}

/**
 * Async availability check — used by the /api/sheets/ai-status endpoint.
 * For Ollama, this actually probes the local server (vs. the cached sync check).
 */
async function describeProviderAsync() {
  const p = selectedProvider();
  if (!p) return describeProvider();
  if (p === ollamaProvider) {
    const live = await ollamaProvider.isAvailableAsync();
    return { ...ollamaProvider.describe(), available: live };
  }
  return p.describe();
}

module.exports = { converse, isLLMAvailable, describeProvider, describeProviderAsync };
