/**
 * conversationEngine - Multi-turn natural-language sheet builder.
 *
 * Input: { message, currentSpec, analysis, history }
 * Output: { newSpec, reply, actions, suggestions, confidence }
 *
 * Heuristic pattern-matching with a small "intent grammar". This is the
 * "Ask Data" approach Tableau used pre-LLM, made multi-turn aware via the
 * currentSpec parameter so users can iterate ("now break that out by quarter").
 *
 * Architecture is LLM-ready: a future version can replace classifyIntent()
 * with a model call, while keeping the spec-merge logic intact.
 */

const FIELD_PATTERNS = {
  // Common synonyms that map to field name patterns
  revenue: ['revenue','sales','income','amount','total'],
  cost: ['cost','expense','spend','spending'],
  profit: ['profit','margin','earnings'],
  count: ['count','number of','how many','quantity'],
  date: ['date','time','when','year','month','quarter','day','week'],
  customer: ['customer','client','buyer','user'],
  product: ['product','item','sku','goods'],
  region: ['region','area','location','zone','territory'],
  category: ['category','type','class','kind','group'],
};

const AGG_WORDS = {
  sum: ['sum','total','add up','aggregate'],
  avg: ['average','mean','typical'],
  count: ['count','number','how many'],
  min: ['minimum','min','lowest','smallest'],
  max: ['maximum','max','highest','largest','peak'],
  median: ['median','middle'],
};

const CHART_WORDS = {
  bar: ['bar','column','bars'],
  line: ['line','trend','over time'],
  pie: ['pie','donut','share','breakdown'],
  scatter: ['scatter','correlation','relationship','vs'],
  area: ['area','filled'],
  histogram: ['histogram','distribution'],
  heatmap: ['heatmap','heat map'],
  treemap: ['treemap','tree map','hierarchy'],
  map: ['map','geography','geographic'],
  forecast: ['forecast','predict','projection','future'],
};

// ─── HELPERS ───
function tokensIn(s) {
  return s.toLowerCase().replace(/[^a-z0-9_\s]/g, ' ').split(/\s+/).filter(Boolean);
}

// Find which dataset columns are mentioned in a message. Score by overlap.
function findMentionedFields(message, columns) {
  const msg = message.toLowerCase();
  const msgTokens = new Set(tokensIn(message));
  const matches = [];

  for (const col of columns) {
    const colName = col.name.toLowerCase();
    const colTokens = tokensIn(col.name);

    // Exact match (full column name appears in message)
    if (msg.includes(colName)) {
      matches.push({ col, score: 100, type: 'exact' });
      continue;
    }
    // Dashed/spaced version
    const colVariants = [colName.replace(/_/g, ' '), colName.replace(/_/g, '')];
    if (colVariants.some(v => msg.includes(v))) {
      matches.push({ col, score: 90, type: 'variant' });
      continue;
    }
    // Token overlap
    const partial = colTokens.filter(t => t.length > 2 && msgTokens.has(t)).length;
    if (partial && partial / colTokens.length >= 0.5) {
      matches.push({ col, score: 50 + partial * 5, type: 'partial' });
      continue;
    }
    // Synonym map: check both ways. e.g., "revenue" in message → "Sales" column
    let synMatched = false;
    for (const [key, syns] of Object.entries(FIELD_PATTERNS)) {
      // Forward: column name contains key, message contains a synonym
      const colHasKey = colTokens.some(t => t.includes(key)) || syns.some(s => colName.includes(s));
      const msgHasSyn = syns.some(s => msg.includes(s)) || msg.includes(key);
      if (colHasKey && msgHasSyn) { matches.push({ col, score: 35, type: 'synonym' }); synMatched = true; break; }
    }
  }
  // Dedupe + sort by score
  const seen = new Set();
  return matches.filter(m => { if (seen.has(m.col.name)) return false; seen.add(m.col.name); return true; })
                .sort((a, b) => b.score - a.score);
}

function isMeasure(col) {
  return col.type === 'numeric' && col.subtype !== 'identifier' && col.subtype !== 'year' && col.subtype !== 'coordinate';
}

function detectAggregation(message) {
  const msg = message.toLowerCase();
  for (const [agg, words] of Object.entries(AGG_WORDS)) {
    if (words.some(w => msg.includes(w))) return agg;
  }
  return null;
}

function detectChartType(message) {
  const msg = message.toLowerCase();
  for (const [chart, words] of Object.entries(CHART_WORDS)) {
    if (words.some(w => msg.includes(w))) return chart;
  }
  return null;
}

// ─── INTENT CLASSIFIER ───
function classifyIntent(message, currentSpec) {
  const msg = message.toLowerCase().trim();
  const hasCurrent = currentSpec && (currentSpec.columns?.length || currentSpec.rows?.length);

  if (/^(reset|start over|clear|new|forget)/i.test(msg)) return 'reset';
  if (/^(undo|go back|revert)/i.test(msg)) return 'undo';
  if (/(remove|drop|delete|take out|get rid of) (the )?(\w+)/i.test(msg)) return 'remove_field';

  // CHART TYPE comes BEFORE replace (since "change to bar" matches both)
  if (/(as a |as an |make it (a |an )?|change(d)? to (a |an )?|show as (a |an )?|switch(ed)? to (a |an )?|turn into (a |an )?)?(bar|pie|line|area|scatter|donut|histogram|map|treemap|heatmap|forecast)\s*(chart|graph|plot)?/i.test(msg) &&
      /(bar|pie|line|area|scatter|donut|histogram|map|treemap|heatmap|forecast)/i.test(msg) &&
      hasCurrent &&
      !/(show|display|plot|visualize) (me )?[a-z]+ (by|over)/i.test(msg)) return 'change_chart';

  // Aggregation change BEFORE replace
  // "use average instead", "show me average", "switch to mean"
  if (/(use|show|give me|i want|switch to|let's see)\s+(the\s+)?(average|mean|count|sum|maximum|minimum|median|total)( instead)?\b/i.test(msg) && hasCurrent) {
    return 'change_aggregation';
  }
  if (/^(average|mean|count|sum|maximum|minimum|median)\b/i.test(msg) && hasCurrent) {
    return 'change_aggregation';
  }

  if (/^(top|bottom|first|last) \d+/i.test(msg)) return 'limit';
  if (/(only|just |filter|where)/i.test(msg)) return 'filter';
  if (/(replace|swap|use \w+ instead|instead of)/i.test(msg)) return 'replace';
  if (/(profit|margin|growth rate|ratio|share|percent of|conversion)/i.test(msg) && !hasCurrent) return 'create_calc_field';
  if (/(profit|margin|growth rate)/i.test(msg) && hasCurrent) return 'create_calc_field';
  if (/(now|also|and |plus|add|include|with |broken? down by|grouped? by| by )/i.test(msg) && hasCurrent) return 'add_field';
  if (/(predict|forecast|project)/i.test(msg)) return 'forecast';
  if (/(show|display|chart|plot|visualize|graph|see)/i.test(msg) || !hasCurrent) return 'create';
  return hasCurrent ? 'modify' : 'create';
}

// ─── INTENT HANDLERS ───
// Each returns: { newSpec, reply, actions, suggestions }

function handleCreate(message, analysis) {
  const cols = analysis.columns;
  const mentioned = findMentionedFields(message, cols);

  if (!mentioned.length) {
    return {
      newSpec: null,
      reply: "I couldn't identify any fields in your dataset. Try mentioning a column name, like 'show me sales by region'.",
      suggestions: cols.slice(0, 4).map(c => `Show me ${c.name}`),
      confidence: 0.1,
    };
  }

  // Split into measures and dimensions
  const measures = mentioned.filter(m => isMeasure(m.col));
  const dims = mentioned.filter(m => !isMeasure(m.col));
  const agg = detectAggregation(message) || 'sum';
  const requestedChart = detectChartType(message);

  // Default heuristic: dims → columns shelf, measures → rows shelf
  let dimensionCol = dims[0]?.col;
  let measureCols = measures.length ? measures.map(m => m.col) : null;

  // If no measure mentioned, find one to default to (largest numeric)
  if (!measureCols) {
    const numericCols = cols.filter(isMeasure);
    if (numericCols.length) measureCols = [numericCols[0]];
  }

  // If no dim mentioned, find one (first categorical)
  if (!dimensionCol) {
    const dimCols = cols.filter(c => !isMeasure(c));
    if (dimCols.length) dimensionCol = dimCols[0];
  }

  // Pick chart type
  let chartType = requestedChart || 'bar';
  if (!requestedChart) {
    // Auto-select based on shape
    if (dimensionCol?.type === 'temporal' || dimensionCol?.subtype === 'year') chartType = 'line';
    else if (dimensionCol && measureCols?.length === 1 && (analysis.columns.find(c => c.name === dimensionCol.name)?.unique || 5) <= 8) chartType = 'bar';
    else if (measureCols?.length >= 2) chartType = 'bar'; // grouped multi
  }

  const newSpec = {
    chartType,
    columns: dimensionCol ? [{ name: dimensionCol.name, type: dimensionCol.type }] : [],
    rows: (measureCols || []).map(m => ({ name: m.name, type: 'numeric', aggregation: agg })),
    color: null, size: null,
    aggregations: Object.fromEntries((measureCols || []).map(m => [m.name, agg])),
    filters: [],
    calculatedFields: [],
  };

  const measureNames = (measureCols || []).map(m => m.name).join(' + ');
  const reply = dimensionCol && measureCols?.length
    ? `Showing ${agg.toUpperCase()} of ${measureNames} by ${dimensionCol.name} as a ${chartType} chart.`
    : `Started a ${chartType} chart. Add more details to refine it.`;

  return {
    newSpec, reply,
    actions: [`Set chart to ${chartType}`, dimensionCol && `Added ${dimensionCol.name} to columns`, ...(measureCols||[]).map(m => `Added ${m.name} (${agg}) to rows`)].filter(Boolean),
    suggestions: [
      'Now break that out by ' + (cols.find(c => !isMeasure(c) && c.name !== dimensionCol?.name)?.name || 'category'),
      'Show the top 5 only',
      'As a pie chart',
    ],
    confidence: 0.85,
  };
}

function handleAddField(message, currentSpec, analysis) {
  const mentioned = findMentionedFields(message, analysis.columns);
  if (!mentioned.length) return { newSpec: currentSpec, reply: "I didn't catch which field to add.", confidence: 0.1 };

  const newSpec = JSON.parse(JSON.stringify(currentSpec));
  const actions = [];
  for (const m of mentioned) {
    const field = m.col;
    const inCols = newSpec.columns?.some(c => c.name === field.name);
    const inRows = newSpec.rows?.some(r => r.name === field.name);
    if (inCols || inRows) continue; // already there

    if (isMeasure(field)) {
      const agg = detectAggregation(message) || 'sum';
      newSpec.rows = [...(newSpec.rows||[]), { name: field.name, type: 'numeric', aggregation: agg }];
      newSpec.aggregations = { ...(newSpec.aggregations||{}), [field.name]: agg };
      actions.push(`Added ${field.name} (${agg}) to rows`);
    } else {
      newSpec.columns = [...(newSpec.columns||[]), { name: field.name, type: field.type }];
      actions.push(`Added ${field.name} to columns`);
    }
  }

  return {
    newSpec,
    reply: actions.length ? `Done. ${actions.join('. ')}.` : 'Those fields are already on the chart.',
    actions,
    confidence: 0.8,
  };
}

function handleRemoveField(message, currentSpec, analysis) {
  const mentioned = findMentionedFields(message, analysis.columns);
  if (!mentioned.length) return { newSpec: currentSpec, reply: "I didn't catch which field to remove.", confidence: 0.1 };

  const newSpec = JSON.parse(JSON.stringify(currentSpec));
  const removed = [];
  for (const m of mentioned) {
    const before = (newSpec.columns?.length || 0) + (newSpec.rows?.length || 0);
    newSpec.columns = (newSpec.columns||[]).filter(c => c.name !== m.col.name);
    newSpec.rows = (newSpec.rows||[]).filter(r => r.name !== m.col.name);
    const after = (newSpec.columns?.length || 0) + (newSpec.rows?.length || 0);
    if (after < before) removed.push(m.col.name);
  }
  return {
    newSpec,
    reply: removed.length ? `Removed ${removed.join(', ')} from the chart.` : "Those fields weren't on the chart.",
    actions: removed.map(r => `Removed ${r}`),
    confidence: 0.85,
  };
}

function handleFilter(message, currentSpec, analysis) {
  const newSpec = JSON.parse(JSON.stringify(currentSpec || {}));
  newSpec.filters = newSpec.filters || [];
  const mentioned = findMentionedFields(message, analysis.columns);

  // Numeric filter first: "where sales > 1000"
  const numMatch = message.match(/(?:where\s+)?([\w_]+)\s*(>=|<=|>|<|=)\s*([\d.]+)/i);
  if (numMatch) {
    const fieldName = numMatch[1];
    const matchCol = analysis.columns.find(c => c.name.toLowerCase() === fieldName.toLowerCase());
    if (matchCol) {
      newSpec.filters.push({ field: matchCol.name, op: numMatch[2] === '=' ? '=' : numMatch[2], value: Number(numMatch[3]) });
      return {
        newSpec,
        reply: `Filtered ${matchCol.name} ${numMatch[2]} ${numMatch[3]}.`,
        actions: [`Filter: ${matchCol.name} ${numMatch[2]} ${numMatch[3]}`],
        confidence: 0.8,
      };
    }
  }

  // Pattern: "only X, Y, Z" or "only X and Y" — values follow keyword
  const onlyMatch = message.match(/(?:only|just|where)\s+(.+?)\s*$/i);
  let values = [];
  let targetField = null;

  if (onlyMatch) {
    const after = onlyMatch[1].trim();
    // Split by comma or "and"
    const candidates = after.split(/\s*,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean);
    // For each candidate, see if it matches a value in any field
    // First, check if any candidates are field names themselves (don't include those)
    const dimMentioned = mentioned.filter(m => !isMeasure(m.col));

    if (dimMentioned.length) {
      // User said "only Region X, Y" — explicit field
      targetField = dimMentioned[0].col;
      values = candidates.filter(c => c.toLowerCase() !== targetField.name.toLowerCase());
    } else {
      // No field mentioned. Try to infer:
      // 1. Check if values match a field's known categories (best signal)
      // 2. Otherwise default to currentSpec's first dim
      const dimCols = analysis.columns.filter(c => !isMeasure(c));
      let bestMatch = null, bestScore = 0;
      for (const dc of dimCols) {
        // We don't have the actual data here; use heuristic: if any candidate looks like a typical category for this column
        // Best fallback: use current spec's first columns shelf field
      }
      if (currentSpec?.columns?.[0]) {
        targetField = analysis.columns.find(c => c.name === currentSpec.columns[0].name);
        values = candidates;
      }
    }
  }

  if (targetField && values.length) {
    newSpec.filters = newSpec.filters.filter(f => f.field !== targetField.name);
    newSpec.filters.push({ field: targetField.name, op: 'in', value: values });
    return {
      newSpec,
      reply: `Filtered ${targetField.name} to ${values.join(', ')}.`,
      actions: [`Filter: ${targetField.name} in [${values.join(', ')}]`],
      confidence: 0.7,
    };
  }

  return { newSpec: currentSpec, reply: "I need more detail. Try 'only North and South' or 'where sales > 1000'.", confidence: 0.2 };
}

function handleLimit(message, currentSpec) {
  const m = message.match(/(top|bottom|first|last)\s+(\d+)/i);
  if (!m) return { newSpec: currentSpec, confidence: 0.1 };
  const N = Number(m[2]);
  const isTop = /top|first/i.test(m[1]);
  // Find the dimension to limit
  const dimField = currentSpec?.columns?.[0]?.name;
  const measureField = currentSpec?.rows?.[0]?.name;
  if (!dimField) return { newSpec: currentSpec, reply: "Add a dimension first, then I can limit it.", confidence: 0.2 };

  const newSpec = JSON.parse(JSON.stringify(currentSpec));
  newSpec.filters = (newSpec.filters||[]).filter(f => !(f.field === dimField && (f.op === 'top_n' || f.op === 'bottom_n')));
  newSpec.filters.push({ field: dimField, op: isTop ? 'top_n' : 'bottom_n', value: N, by: measureField });
  return {
    newSpec,
    reply: `Showing ${isTop ? 'top' : 'bottom'} ${N} ${dimField} by ${measureField || 'count'}.`,
    actions: [`${isTop ? 'Top' : 'Bottom'} ${N} filter on ${dimField}`],
    confidence: 0.85,
  };
}

function handleChangeChart(message, currentSpec) {
  const chartType = detectChartType(message);
  if (!chartType) return { newSpec: currentSpec, confidence: 0.1 };
  const newSpec = JSON.parse(JSON.stringify(currentSpec));
  newSpec.chartType = chartType;
  return {
    newSpec,
    reply: `Changed to ${chartType} chart.`,
    actions: [`Chart type → ${chartType}`],
    confidence: 0.9,
  };
}

function handleChangeAggregation(message, currentSpec) {
  const agg = detectAggregation(message);
  if (!agg) return { newSpec: currentSpec, confidence: 0.1 };
  const newSpec = JSON.parse(JSON.stringify(currentSpec));
  const mentioned = currentSpec.rows || [];
  if (!mentioned.length) return { newSpec: currentSpec, reply: "Add a measure first.", confidence: 0.2 };

  newSpec.rows = mentioned.map(r => ({ ...r, aggregation: agg }));
  newSpec.aggregations = Object.fromEntries(mentioned.map(r => [r.name, agg]));
  return {
    newSpec,
    reply: `Switched to ${agg.toUpperCase()} for ${mentioned.map(r => r.name).join(', ')}.`,
    actions: [`Aggregation → ${agg}`],
    confidence: 0.85,
  };
}

function handleCreateCalcField(message, currentSpec, analysis) {
  // Detect "profit" or "margin" or "growth"
  const msg = message.toLowerCase();
  const cols = analysis.columns;
  const sales = cols.find(c => /sales|revenue/i.test(c.name) && isMeasure(c));
  const cost = cols.find(c => /cost|expense/i.test(c.name) && isMeasure(c));

  const newSpec = JSON.parse(JSON.stringify(currentSpec || { chartType: 'bar', columns: [], rows: [], filters: [], calculatedFields: [] }));
  newSpec.calculatedFields = newSpec.calculatedFields || [];

  if (/(profit margin|margin %|margin percent)/i.test(msg) && sales && cost) {
    if (!newSpec.calculatedFields.find(c => c.name === 'Profit Margin %')) {
      newSpec.calculatedFields.push({ name: 'Profit Margin %', formula: `ROUND(([${sales.name}] - [${cost.name}]) / [${sales.name}] * 100, 1)` });
    }
    return {
      newSpec, reply: `Created Profit Margin % = ([${sales.name}] - [${cost.name}]) / [${sales.name}] × 100`,
      actions: ['Created calc field: Profit Margin %'],
      confidence: 0.9,
    };
  }
  if (/profit/i.test(msg) && sales && cost) {
    if (!newSpec.calculatedFields.find(c => c.name === 'Profit')) {
      newSpec.calculatedFields.push({ name: 'Profit', formula: `[${sales.name}] - [${cost.name}]` });
    }
    return {
      newSpec, reply: `Created Profit = [${sales.name}] - [${cost.name}]`,
      actions: ['Created calc field: Profit'],
      confidence: 0.9,
    };
  }

  return { newSpec: currentSpec, reply: "I can suggest calc fields once I see Sales/Cost-style columns. Open the Formulas tab to create one manually.", confidence: 0.2 };
}

function handleReset() {
  return {
    newSpec: { chartType: 'bar', columns: [], rows: [], filters: [], calculatedFields: [], color: null, size: null, aggregations: {} },
    reply: 'Cleared. Ready for a fresh chart.',
    actions: ['Reset spec'],
    confidence: 1.0,
  };
}

// ─── PUBLIC ENTRY ───
function converse({ message, currentSpec, analysis }) {
  if (!message?.trim()) return { newSpec: currentSpec, reply: 'Type a question or instruction.', confidence: 0 };
  if (!analysis?.columns) return { newSpec: currentSpec, reply: 'No dataset loaded.', confidence: 0 };

  const intent = classifyIntent(message, currentSpec);
  let result;
  switch (intent) {
    case 'reset': result = handleReset(); break;
    case 'add_field': result = handleAddField(message, currentSpec, analysis); break;
    case 'remove_field': result = handleRemoveField(message, currentSpec, analysis); break;
    case 'filter': result = handleFilter(message, currentSpec, analysis); break;
    case 'limit': result = handleLimit(message, currentSpec); break;
    case 'change_chart': result = handleChangeChart(message, currentSpec); break;
    case 'change_aggregation': result = handleChangeAggregation(message, currentSpec); break;
    case 'create_calc_field': result = handleCreateCalcField(message, currentSpec, analysis); break;
    case 'replace': {
      // Replace = remove existing measure/dim and add the new one
      const r1 = handleRemoveField(message, currentSpec, analysis);
      result = handleAddField(message, r1.newSpec || currentSpec, analysis);
      result.reply = result.reply.replace('Done. ', 'Replaced. ');
      break;
    }
    default: result = handleCreate(message, analysis); break;
  }

  return { ...result, intent };
}

module.exports = { converse, classifyIntent, findMentionedFields };
