/**
 * Table calculations (window functions).
 *
 * These run AFTER aggregation, on the already-shaped chart data. They're
 * fundamentally different from row-level calc fields and aggregates:
 *
 *   Row-level calc:  [Sales] - [Cost]              → one value per source row
 *   Aggregate:       SUM([Sales])                  → one value per group
 *   Table calc:      RUNNING_SUM(SUM([Sales]))     → one value per group, computed
 *                                                    by walking the result table
 *
 * Tableau calls these "table calcs". We support:
 *   - RUNNING_SUM, RUNNING_AVG, RUNNING_MIN, RUNNING_MAX, RUNNING_COUNT
 *   - MOVING_AVG(field, n), MOVING_SUM(field, n)
 *   - WINDOW_AVG, WINDOW_SUM, WINDOW_MIN, WINDOW_MAX (over entire result set)
 *   - RANK(field, [direction]), INDEX()
 *   - LOOKUP(field, offset)
 *   - PERCENT_OF_TOTAL(field), DIFFERENCE(field), PERCENT_DIFFERENCE(field)
 *
 * Each table calc is defined as { name, expression, partitionBy?, orderBy? }
 * The expression is a JS-like string; we have a simple parser.
 *
 * Public API:
 *   - validate(expression, availableFields) → { ok, error?, missing? }
 *   - apply(rows, tableCalcs) → rows with new fields populated
 *   - listFunctions() → for UI dropdowns
 */

// ─── REGISTRY ────────────────────────────────────────────────────────────────

const FUNCTIONS = {
  // Running aggregations — accumulate as we walk the partition
  RUNNING_SUM: { args: [{ type: 'field' }],                 directional: true },
  RUNNING_AVG: { args: [{ type: 'field' }],                 directional: true },
  RUNNING_MIN: { args: [{ type: 'field' }],                 directional: true },
  RUNNING_MAX: { args: [{ type: 'field' }],                 directional: true },
  RUNNING_COUNT: { args: [],                                directional: true },

  // Moving (windowed) aggregations
  MOVING_AVG: { args: [{ type: 'field' }, { type: 'number', name: 'window' }], directional: true },
  MOVING_SUM: { args: [{ type: 'field' }, { type: 'number', name: 'window' }], directional: true },

  // Whole-partition aggregations — same value broadcast to every row
  WINDOW_SUM: { args: [{ type: 'field' }] },
  WINDOW_AVG: { args: [{ type: 'field' }] },
  WINDOW_MIN: { args: [{ type: 'field' }] },
  WINDOW_MAX: { args: [{ type: 'field' }] },

  // Position-based
  RANK: { args: [{ type: 'field' }, { type: 'string', name: 'direction', optional: true }], directional: true },
  DENSE_RANK: { args: [{ type: 'field' }, { type: 'string', name: 'direction', optional: true }], directional: true },
  INDEX: { args: [],                                         directional: true },

  // Inter-row lookup
  LOOKUP: { args: [{ type: 'field' }, { type: 'number', name: 'offset' }], directional: true },
  DIFFERENCE: { args: [{ type: 'field' }],                   directional: true },
  PERCENT_DIFFERENCE: { args: [{ type: 'field' }],           directional: true },

  // Ratio against partition total
  PERCENT_OF_TOTAL: { args: [{ type: 'field' }] },
};

// ─── PARSER ──────────────────────────────────────────────────────────────────

/**
 * Parse a table calc expression like:
 *   RUNNING_SUM(SUM([Sales]))
 *   MOVING_AVG(SUM([Sales]), 3)
 *   RANK(SUM([Sales]), "desc")
 *
 * The argument can be a field reference like SUM([Sales]) (which after
 * aggregation becomes a column in the result table — we identify it by name)
 * OR a bare column name like [SUM_Sales] (already-shaped column).
 *
 * Returns AST: { fn, args: [...resolved values] }
 */
function parseExpression(expression, availableFields) {
  if (!expression || typeof expression !== 'string') {
    throw new Error('Empty expression');
  }

  const trimmed = expression.trim();
  const match = trimmed.match(/^([A-Z_]+)\s*\((.*)\)$/i);
  if (!match) throw new Error('Expected FUNCTION(args) syntax');

  const fnName = match[1].toUpperCase();
  const argsStr = match[2].trim();

  if (!FUNCTIONS[fnName]) {
    throw new Error(`Unknown table calc function: ${fnName}`);
  }

  // Split args at commas — but respect nested parens and brackets
  const args = splitArgs(argsStr);

  // First arg (if expected) is a field reference — could be a bracketed
  // column name [Sales] or an aggregate-style SUM([Sales]) which we resolve
  // to the column name the aggregator produced (e.g. "Sales_sum").
  const sig = FUNCTIONS[fnName];
  const resolvedArgs = [];

  for (let i = 0; i < sig.args.length; i++) {
    const expected = sig.args[i];
    const raw = args[i];

    if (raw === undefined) {
      if (expected.optional) { resolvedArgs.push(null); continue; }
      throw new Error(`${fnName}: missing argument ${i + 1}`);
    }

    if (expected.type === 'field') {
      const fieldName = resolveFieldRef(raw, availableFields);
      resolvedArgs.push({ type: 'field', name: fieldName });
    } else if (expected.type === 'number') {
      const n = parseFloat(raw);
      if (!Number.isFinite(n)) throw new Error(`${fnName}: argument ${i + 1} must be a number`);
      resolvedArgs.push({ type: 'number', value: n });
    } else if (expected.type === 'string') {
      // strip quotes
      const s = raw.replace(/^["']|["']$/g, '');
      resolvedArgs.push({ type: 'string', value: s });
    }
  }

  return { fn: fnName, args: resolvedArgs };
}

function splitArgs(s) {
  const out = [];
  let depth = 0, bracketDepth = 0, current = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === '[') bracketDepth++;
    else if (c === ']') bracketDepth--;
    if (c === ',' && depth === 0 && bracketDepth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function resolveFieldRef(raw, availableFields) {
  // Forms supported:
  //   [Sales]                 → "Sales" (must exist in availableFields)
  //   SUM([Sales])            → "Sales_sum" or "SUM(Sales)" depending on aggregator naming
  //   Sales                   → "Sales" (bare ident)
  const bracketed = raw.match(/^\[([^\]]+)\]$/);
  if (bracketed) return bracketed[1];

  const aggCall = raw.match(/^(SUM|AVG|COUNT|MIN|MAX|MEDIAN|COUNTD)\s*\(\s*\[([^\]]+)\]\s*\)$/i);
  if (aggCall) {
    // Try several naming conventions to find the aggregated column
    const fn = aggCall[1].toUpperCase();
    const field = aggCall[2];
    const candidates = [
      `${field}_${fn.toLowerCase()}`,
      `${fn.toLowerCase()}_${field}`,
      `${fn}(${field})`,
      field,
    ];
    for (const c of candidates) if (availableFields.includes(c)) return c;
    // Best-effort fallback: just return the field name
    return field;
  }

  // Bare ident
  const cleaned = raw.trim();
  return cleaned;
}

// ─── EXECUTION ───────────────────────────────────────────────────────────────

/**
 * Apply table calcs to the chart-shaped rows. Returns a new array (does not
 * mutate). Each calc adds one new column to every row.
 *
 * @param rows  Array of objects (already aggregated/grouped chart data)
 * @param tableCalcs  Array of { name, expression, partitionBy?, orderBy? }
 * @param availableFields  Array of column names already in `rows`
 */
function apply(rows, tableCalcs, availableFields) {
  if (!Array.isArray(rows) || !rows.length) return rows;
  if (!Array.isArray(tableCalcs) || !tableCalcs.length) return rows;

  // Clone rows so each calc sees the previous calc's output (allows chaining)
  let out = rows.map(r => ({ ...r }));
  const fields = [...(availableFields || Object.keys(rows[0] || {}))];

  for (const calc of tableCalcs) {
    if (!calc || !calc.name || !calc.expression) continue;
    let ast;
    try {
      ast = parseExpression(calc.expression, fields);
    } catch (err) {
      // Skip bad calcs — record an error column
      console.warn(`[tableCalcs] ${calc.name}: ${err.message}`);
      out.forEach(r => { r[calc.name] = null; });
      continue;
    }

    const partitions = partitionRows(out, calc.partitionBy);
    for (const part of partitions) {
      executePartition(part, ast, calc.name);
    }
    fields.push(calc.name);
  }

  return out;
}

/**
 * Group rows into partitions. partitionBy is an array of column names;
 * if absent, the entire result set is one big partition.
 * Preserves the original order within each partition.
 */
function partitionRows(rows, partitionBy) {
  if (!partitionBy || !partitionBy.length) return [rows];
  const map = new Map();
  for (const r of rows) {
    const key = partitionBy.map(c => String(r[c])).join('||');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return Array.from(map.values());
}

/**
 * Execute one calc over one partition. Mutates the rows in place
 * (we already cloned them at the top of apply()).
 */
function executePartition(rows, ast, outName) {
  const fn = ast.fn;

  switch (fn) {
    case 'RUNNING_SUM': {
      const f = ast.args[0].name;
      let sum = 0;
      for (const r of rows) {
        const v = num(r[f]);
        if (v != null) sum += v;
        r[outName] = sum;
      }
      break;
    }

    case 'RUNNING_AVG': {
      const f = ast.args[0].name;
      let sum = 0, count = 0;
      for (const r of rows) {
        const v = num(r[f]);
        if (v != null) { sum += v; count++; }
        r[outName] = count > 0 ? sum / count : null;
      }
      break;
    }

    case 'RUNNING_MIN': {
      const f = ast.args[0].name;
      let cur = null;
      for (const r of rows) {
        const v = num(r[f]);
        if (v != null) cur = (cur == null) ? v : Math.min(cur, v);
        r[outName] = cur;
      }
      break;
    }

    case 'RUNNING_MAX': {
      const f = ast.args[0].name;
      let cur = null;
      for (const r of rows) {
        const v = num(r[f]);
        if (v != null) cur = (cur == null) ? v : Math.max(cur, v);
        r[outName] = cur;
      }
      break;
    }

    case 'RUNNING_COUNT': {
      let n = 0;
      for (const r of rows) { n++; r[outName] = n; }
      break;
    }

    case 'MOVING_AVG':
    case 'MOVING_SUM': {
      const f = ast.args[0].name;
      const window = Math.max(1, Math.floor(ast.args[1].value));
      const useAvg = fn === 'MOVING_AVG';
      for (let i = 0; i < rows.length; i++) {
        const start = Math.max(0, i - window + 1);
        let sum = 0, count = 0;
        for (let j = start; j <= i; j++) {
          const v = num(rows[j][f]);
          if (v != null) { sum += v; count++; }
        }
        rows[i][outName] = useAvg ? (count > 0 ? sum / count : null) : sum;
      }
      break;
    }

    case 'WINDOW_SUM':
    case 'WINDOW_AVG':
    case 'WINDOW_MIN':
    case 'WINDOW_MAX': {
      const f = ast.args[0].name;
      const values = rows.map(r => num(r[f])).filter(v => v != null);
      let result = null;
      if (values.length) {
        if (fn === 'WINDOW_SUM') result = values.reduce((a, b) => a + b, 0);
        else if (fn === 'WINDOW_AVG') result = values.reduce((a, b) => a + b, 0) / values.length;
        else if (fn === 'WINDOW_MIN') result = Math.min(...values);
        else if (fn === 'WINDOW_MAX') result = Math.max(...values);
      }
      for (const r of rows) r[outName] = result;
      break;
    }

    case 'PERCENT_OF_TOTAL': {
      const f = ast.args[0].name;
      const total = rows.reduce((acc, r) => acc + (num(r[f]) || 0), 0);
      for (const r of rows) {
        const v = num(r[f]);
        r[outName] = (total !== 0 && v != null) ? (v / total) * 100 : null;
      }
      break;
    }

    case 'RANK':
    case 'DENSE_RANK': {
      const f = ast.args[0].name;
      const direction = (ast.args[1] && ast.args[1].value || 'desc').toLowerCase();
      const indexed = rows.map((r, i) => ({ idx: i, v: num(r[f]) }));
      indexed.sort((a, b) => {
        if (a.v == null && b.v == null) return 0;
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        return direction === 'asc' ? a.v - b.v : b.v - a.v;
      });
      let rank = 0, prev = Symbol('never'), tieCount = 0;
      for (let pos = 0; pos < indexed.length; pos++) {
        const cur = indexed[pos].v;
        if (cur === prev) {
          // tie — same rank as previous
          tieCount++;
        } else {
          rank = (fn === 'DENSE_RANK') ? rank + 1 : pos + 1;
          tieCount = 0;
        }
        prev = cur;
        rows[indexed[pos].idx][outName] = cur == null ? null : rank;
      }
      break;
    }

    case 'INDEX': {
      for (let i = 0; i < rows.length; i++) rows[i][outName] = i + 1;
      break;
    }

    case 'LOOKUP': {
      const f = ast.args[0].name;
      const offset = Math.floor(ast.args[1].value);
      for (let i = 0; i < rows.length; i++) {
        const j = i + offset;
        rows[i][outName] = (j >= 0 && j < rows.length) ? rows[j][f] : null;
      }
      break;
    }

    case 'DIFFERENCE': {
      const f = ast.args[0].name;
      let prev = null;
      for (const r of rows) {
        const v = num(r[f]);
        r[outName] = (prev != null && v != null) ? v - prev : null;
        prev = v;
      }
      break;
    }

    case 'PERCENT_DIFFERENCE': {
      const f = ast.args[0].name;
      let prev = null;
      for (const r of rows) {
        const v = num(r[f]);
        r[outName] = (prev != null && prev !== 0 && v != null) ? ((v - prev) / prev) * 100 : null;
        prev = v;
      }
      break;
    }

    default:
      throw new Error(`Unhandled function: ${fn}`);
  }
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ─── PUBLIC HELPERS ──────────────────────────────────────────────────────────

function validate(expression, availableFields = []) {
  try {
    parseExpression(expression, availableFields);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function listFunctions() {
  return Object.entries(FUNCTIONS).map(([name, sig]) => ({
    name,
    signature: signatureString(name, sig),
    directional: !!sig.directional,
  }));
}

function signatureString(name, sig) {
  const args = sig.args.map(a => {
    if (a.type === 'field') return '[Field]';
    if (a.type === 'number') return a.name || 'N';
    if (a.type === 'string') return `"${a.name || 'value'}"${a.optional ? '?' : ''}`;
    return '?';
  }).join(', ');
  return `${name}(${args})`;
}

module.exports = {
  apply,
  validate,
  listFunctions,
  parseExpression,
  // Exposed for tests
  _splitArgs: splitArgs,
};
