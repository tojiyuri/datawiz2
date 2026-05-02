/**
 * Level of Detail (LOD) expressions.
 *
 * Tableau's killer feature for advanced calcs. Lets you compute aggregates
 * at a different granularity than the chart's view.
 *
 * Three flavors in Tableau:
 *   - {FIXED dim1, dim2 : SUM([Sales])}    — aggregate at exactly these dims
 *   - {INCLUDE dim : ...}                  — view dims + these
 *   - {EXCLUDE dim : ...}                  — view dims minus these
 *
 * **Scope of this implementation:** FIXED only.
 *
 * INCLUDE and EXCLUDE require knowing the "current view" at calc time, which
 * means tightly coupling LOD to the chart spec. FIXED is by far the most
 * common (~80% of LOD usage in real dashboards), and it's self-contained.
 *
 * Strategy: LOD calcs run BEFORE other calculated fields. We compute the
 * aggregate per partition (defined by FIXED dims), then broadcast that value
 * back to every source row. The result becomes a new column that downstream
 * calcs/charts treat as a normal field.
 *
 * Example:
 *   { name: 'Region Total', expression: '{FIXED [Region]: SUM([Sales])}' }
 *
 * Adds a `Region Total` column to every row, where rows in the same region
 * all share the same value (the sum of Sales for that region).
 *
 * That lets you compute "% of region" downstream:
 *   { name: '% of Region', formula: '[Sales] / [Region Total] * 100' }
 *
 * Which is something you can't do with row-level or aggregate calcs alone.
 */

const LOD_PATTERN = /^\s*\{\s*FIXED\s+(.*?)\s*:\s*(.+?)\s*\}\s*$/i;

function parseLOD(expression) {
  if (!expression || typeof expression !== 'string') return null;
  const m = expression.match(LOD_PATTERN);
  if (!m) return null;

  const dimsRaw = m[1];
  const aggExpr = m[2];

  // Parse dims: comma-separated list of [Field] or bare field names
  const dims = dimsRaw
    .split(',')
    .map(s => s.trim())
    .map(s => {
      const bracketed = s.match(/^\[([^\]]+)\]$/);
      return bracketed ? bracketed[1] : s;
    })
    .filter(Boolean);

  if (!dims.length) throw new Error('LOD: at least one FIXED dimension is required');

  // Parse aggregation: SUM([Sales]), AVG([Cost]), etc.
  const aggMatch = aggExpr.match(/^([A-Z_]+)\s*\(\s*\[([^\]]+)\]\s*\)\s*$/i);
  if (!aggMatch) {
    throw new Error('LOD: expression must be AGG([Field]) where AGG is SUM/AVG/MIN/MAX/COUNT/COUNTD/MEDIAN');
  }

  const fn = aggMatch[1].toUpperCase();
  const field = aggMatch[2];

  if (!['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNTD', 'MEDIAN'].includes(fn)) {
    throw new Error(`LOD: unsupported aggregation ${fn}`);
  }

  return { type: 'fixed', dims, fn, field };
}

function isLOD(expression) {
  return LOD_PATTERN.test(String(expression || ''));
}

/**
 * Apply LOD expressions to source data. Each LOD adds one column to every row.
 * Operates in two passes:
 *   1. Group rows by FIXED dimensions, compute the aggregate per group
 *   2. Walk rows again, attach the per-group value as a new field
 *
 * lods: Array of { name, expression }
 */
function applyLODs(data, lods) {
  if (!Array.isArray(lods) || !lods.length) return data;
  const out = data.map(r => ({ ...r }));

  for (const lod of lods) {
    if (!lod?.name || !lod?.expression) continue;
    let parsed;
    try { parsed = parseLOD(lod.expression); }
    catch (err) {
      console.warn(`[lod] ${lod.name}: ${err.message}`);
      out.forEach(r => { r[lod.name] = null; });
      continue;
    }
    if (!parsed) {
      // Not actually a LOD — let other systems handle it
      continue;
    }
    computeFixed(out, parsed, lod.name);
  }

  return out;
}

function computeFixed(rows, parsed, outName) {
  const { dims, fn, field } = parsed;

  // Pass 1: group + aggregate
  const groups = new Map();
  for (const r of rows) {
    const key = dims.map(d => `${r[d] == null ? '__null__' : String(r[d])}`).join('||');
    if (!groups.has(key)) groups.set(key, []);
    const v = r[field];
    if (v != null && v !== '') groups.get(key).push(v);
  }

  const aggregated = new Map();
  for (const [key, values] of groups.entries()) {
    aggregated.set(key, aggregate(values, fn));
  }

  // Pass 2: broadcast back
  for (const r of rows) {
    const key = dims.map(d => `${r[d] == null ? '__null__' : String(r[d])}`).join('||');
    r[outName] = aggregated.get(key);
  }
}

function aggregate(values, fn) {
  if (!values.length) return null;

  if (fn === 'COUNT') return values.length;
  if (fn === 'COUNTD') return new Set(values.map(String)).size;

  const nums = values.map(v => {
    if (typeof v === 'number') return v;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }).filter(v => v != null);

  if (!nums.length) return null;

  switch (fn) {
    case 'SUM': return nums.reduce((a, b) => a + b, 0);
    case 'AVG': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'MIN': return Math.min(...nums);
    case 'MAX': return Math.max(...nums);
    case 'MEDIAN': {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    default: return null;
  }
}

function validateLOD(expression, columnNames = []) {
  try {
    const parsed = parseLOD(expression);
    if (!parsed) return { ok: false, error: 'Not a valid LOD expression — expected {FIXED [dim]: AGG([field])}' };
    const missing = [];
    for (const d of parsed.dims) if (!columnNames.includes(d)) missing.push(d);
    if (!columnNames.includes(parsed.field)) missing.push(parsed.field);
    if (missing.length) return { ok: false, missing, error: `Unknown columns: ${missing.join(', ')}` };
    return { ok: true, parsed };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { applyLODs, parseLOD, isLOD, validateLOD };
