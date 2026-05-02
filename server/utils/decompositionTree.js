/**
 * Decomposition tree engine.
 *
 * Power BI's most-loved feature, the way I think about it:
 *
 *   "Sales is $1.2M. Show me how that breaks down."
 *   → expand by Region: East $500K, West $400K, North $200K, South $100K
 *   → click East, expand by Product:  East/Phone $300K, East/Laptop $200K
 *   → click Phone, expand by Quarter: East/Phone/Q1 $80K, ...
 *
 * It's an interactive rolling drill-down. The tree is materialized one level
 * at a time on demand — we don't precompute the whole thing because the
 * combinatorial space is massive.
 *
 * What this module exposes:
 *   - getRoot(dataset, measure, agg)    : the root node (single value)
 *   - expand(dataset, path, dimension)  : children of a node along a chosen dim
 *   - suggestNextDim(dataset, path)     : "AI split" — the dim that would
 *                                          most concentrate or differentiate
 *                                          the children, ranked by signal
 *
 * Why "AI split" is heuristic, not LLM: the signal is mathematical (variance
 * ratio, top-vs-bottom spread, group count). Calling Anthropic for it would
 * be overkill, slower, and the outputs would be less consistent.
 */

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function aggregate(values, fn) {
  if (!values.length) return null;
  switch (fn) {
    case 'sum':   return values.reduce((a, b) => a + b, 0);
    case 'avg':   return values.reduce((a, b) => a + b, 0) / values.length;
    case 'count': return values.length;
    case 'min':   return Math.min(...values);
    case 'max':   return Math.max(...values);
    default:      return values.reduce((a, b) => a + b, 0);
  }
}

/**
 * Filter dataset rows by a path of (dim, value) pairs.
 * Path is [{dim: 'Region', value: 'East'}, {dim: 'Product', value: 'Phone'}].
 */
function filterByPath(rows, path) {
  if (!path?.length) return rows;
  return rows.filter(r => path.every(p => String(r[p.dim] ?? '') === String(p.value)));
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * Compute the root: a single measure value across the entire (filtered) dataset.
 *
 * @param ds        dataset (has .data)
 * @param measure   column name to aggregate
 * @param agg       'sum' | 'avg' | 'count' | 'min' | 'max'
 * @param path      optional filter path (for sub-trees)
 */
function getRoot(ds, measure, agg = 'sum', path = []) {
  if (!ds?.data) throw new Error('Dataset has no data');
  if (!measure) throw new Error('measure is required');

  const filtered = filterByPath(ds.data, path);
  const values = filtered.map(r => num(r[measure])).filter(v => v != null);
  const value = aggregate(values, agg);

  return {
    path,
    measure,
    agg,
    value: value != null ? round(value) : null,
    count: filtered.length,
  };
}

/**
 * Expand a node by a chosen dimension. Returns one child per distinct value
 * of that dimension (top N by aggregated value).
 *
 * @param ds         dataset
 * @param path       current path of (dim, value) pairs to filter by
 * @param dimension  column to group children by
 * @param measure    measure to aggregate
 * @param agg        aggregation
 * @param maxChildren  cap (default 10) to keep the UI sane on high-cardinality dims
 */
function expand(ds, { path = [], dimension, measure, agg = 'sum', maxChildren = 10 }) {
  if (!ds?.data) throw new Error('Dataset has no data');
  if (!dimension) throw new Error('dimension is required');
  if (!measure) throw new Error('measure is required');

  // Refuse to re-split by a dim already in the path — produces a single child
  // and isn't useful.
  if (path.some(p => p.dim === dimension)) {
    throw new Error(`Already filtered by ${dimension} — pick a different dimension`);
  }

  const filtered = filterByPath(ds.data, path);

  // Group filtered rows by the chosen dimension value
  const groups = new Map();
  for (const r of filtered) {
    const key = r[dimension];
    if (key == null || key === '') continue;
    const v = num(r[measure]);
    if (v == null) continue;
    const k = String(key);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }

  const allChildren = Array.from(groups.entries()).map(([value, vals]) => ({
    path: [...path, { dim: dimension, value }],
    dim: dimension,
    value,
    count: vals.length,
    measureValue: round(aggregate(vals, agg)),
  }));

  // Sort by absolute measure value descending (largest first — Pareto-friendly)
  allChildren.sort((a, b) => Math.abs(b.measureValue) - Math.abs(a.measureValue));

  // Cap and indicate truncation
  const truncated = allChildren.length > maxChildren;
  const children = allChildren.slice(0, maxChildren);

  // Compute parent sum to derive child shares
  const parentSum = allChildren.reduce((s, c) => s + (c.measureValue || 0), 0);
  for (const c of children) {
    c.share = parentSum !== 0 ? c.measureValue / parentSum : null;
  }

  return {
    path,
    dimension,
    measure,
    agg,
    parentValue: round(aggregate(filtered.map(r => num(r[measure])).filter(v => v != null), agg)),
    children,
    totalGroups: allChildren.length,
    truncated,
    truncatedShown: children.length,
  };
}

/**
 * "AI split" — score every candidate dimension and rank them by which would
 * produce the most informative split. Two signals combined:
 *
 *   1. Variance reduction: dimensions that segment the measure into very
 *      different groups are more interesting. Computed as eta-squared
 *      (between-group variance / total variance).
 *   2. Concentration: dimensions where the top group dominates suggest
 *      a clear "where it's coming from" story. Computed as top1 / total.
 *
 * The combined score = 0.7 * etaSquared + 0.3 * topShare. Output is sorted
 * descending. UI shows "Suggested: Region (60% from one segment)".
 *
 * Skips: dims already in path, ID-like columns, ultra-high-cardinality cols.
 */
function suggestNextDim(ds, { path = [], measure, agg = 'sum', columns = [] }) {
  if (!ds?.data || !measure) return [];

  const filtered = filterByPath(ds.data, path);
  if (filtered.length < 10) return [];   // not enough data to suggest

  const usedDims = new Set(path.map(p => p.dim));
  const candidates = (columns || ds.analysis?.columns || []).filter(c => {
    if (usedDims.has(c.name)) return false;
    if (c.name === measure) return false;
    const nameL = (c.name || '').toLowerCase();
    if (/^id$|_id$|^uuid|guid|postal|zip$/.test(nameL)) return false;
    if (c.subtype === 'identifier') return false;
    if (c.type !== 'categorical' && c.type !== 'string') return false;
    if (c.uniqueCount && c.uniqueCount > 50) return false;
    return true;
  });

  const suggestions = [];
  for (const dim of candidates) {
    const groups = new Map();
    for (const r of filtered) {
      const k = r[dim.name];
      if (k == null || k === '') continue;
      const v = num(r[measure]);
      if (v == null) continue;
      const ks = String(k);
      if (!groups.has(ks)) groups.set(ks, []);
      groups.get(ks).push(v);
    }
    if (groups.size < 2) continue;

    // Group means + grand mean for eta²
    const allVals = [];
    const groupSums = [];
    for (const [, vals] of groups) {
      allVals.push(...vals);
      groupSums.push({ sum: aggregate(vals, agg), n: vals.length });
    }
    if (allVals.length < 5) continue;

    const grandMean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
    let ssBetween = 0, ssTotal = 0;
    for (const [, vals] of groups) {
      const groupMean = vals.reduce((a, b) => a + b, 0) / vals.length;
      ssBetween += vals.length * (groupMean - grandMean) ** 2;
    }
    for (const v of allVals) ssTotal += (v - grandMean) ** 2;
    const etaSq = ssTotal === 0 ? 0 : ssBetween / ssTotal;

    // Top concentration
    const total = groupSums.reduce((s, g) => s + g.sum, 0);
    const topSum = Math.max(...groupSums.map(g => g.sum));
    const topShare = total !== 0 ? topSum / total : 0;

    const score = 0.7 * etaSq + 0.3 * Math.abs(topShare);
    suggestions.push({
      dim: dim.name,
      score: round(score, 3),
      etaSquared: round(etaSq, 3),
      topShare: round(topShare, 3),
      groupCount: groups.size,
      reason: explain(etaSq, topShare, groups.size),
    });
  }

  suggestions.sort((a, b) => b.score - a.score);
  return suggestions.slice(0, 5);
}

function explain(eta, topShare, n) {
  if (eta > 0.3 && topShare > 0.5) return `${n} groups with one dominant (${Math.round(topShare * 100)}%)`;
  if (eta > 0.3) return `Strong group differences (η²=${eta.toFixed(2)})`;
  if (topShare > 0.6) return `Top group accounts for ${Math.round(topShare * 100)}% of total`;
  return `${n} groups with mild variation`;
}

function round(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

module.exports = { getRoot, expand, suggestNextDim };
