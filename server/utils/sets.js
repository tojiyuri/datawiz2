/**
 * Sets.
 *
 * A Set is a collection of dimension values that can be referenced as a
 * single boolean dimension ("in the set" vs "out of the set"). Two flavors:
 *
 *   1. Manual: explicit list of values
 *      { name: 'Top Customers', source: 'Customer', values: ['Acme', 'Globex'] }
 *
 *   2. Computed: top-N or condition-based
 *      { name: 'Top 10 by Sales', source: 'Customer', mode: 'top',
 *        rankBy: 'Sales', aggregation: 'SUM', count: 10 }
 *      { name: 'High Value', source: 'Sales', mode: 'condition',
 *        condition: { op: '>', value: 1000 } }
 *
 * Sets create a derived boolean column on every row: "<set_name>" with the
 * literal label "In <name>" or "Out of <name>" (so they group cleanly in
 * charts). For computed sets we pre-resolve the membership map.
 *
 * Set membership values are useful as:
 *   - A filter (only show "In Top 10")
 *   - A color encoding (in vs out)
 *   - A grouping dimension
 */

function applySets(data, sets) {
  if (!Array.isArray(sets) || !sets.length) return data;
  const out = data.map(r => ({ ...r }));
  for (const set of sets) {
    if (!set?.name || !set?.source) continue;
    try { applyOne(out, set); }
    catch (err) {
      console.warn(`[sets] ${set.name}: ${err.message}`);
      out.forEach(r => { r[set.name] = `Out of ${set.name}`; });
    }
  }
  return out;
}

function applyOne(rows, set) {
  const { name, source, mode = 'manual' } = set;
  let inSet;

  if (mode === 'manual') {
    const values = new Set((set.values || []).map(v => String(v)));
    inSet = (row) => values.has(String(row[source]));
  }

  else if (mode === 'condition') {
    const cond = set.condition;
    if (!cond) throw new Error('condition set requires a `condition` object');
    inSet = (row) => evaluateCondition(row[source], cond);
  }

  else if (mode === 'top' || mode === 'bottom') {
    const aggregation = (set.aggregation || 'SUM').toUpperCase();
    const rankBy = set.rankBy || source;
    const count = Math.max(1, Math.floor(set.count || 10));

    // Aggregate by source value
    const groups = new Map();
    for (const r of rows) {
      const key = String(r[source]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(toNum(r[rankBy]));
    }
    const aggregated = Array.from(groups.entries()).map(([key, vals]) => ({
      key, agg: aggregateValues(vals, aggregation),
    }));
    aggregated.sort((a, b) => {
      if (a.agg == null) return 1;
      if (b.agg == null) return -1;
      return mode === 'top' ? b.agg - a.agg : a.agg - b.agg;
    });

    const winners = new Set(aggregated.slice(0, count).map(x => x.key));
    inSet = (row) => winners.has(String(row[source]));
  }

  else {
    throw new Error(`Unknown set mode: ${mode}`);
  }

  const inLabel = `In ${name}`;
  const outLabel = `Out of ${name}`;
  for (const r of rows) {
    r[name] = inSet(r) ? inLabel : outLabel;
  }
}

function evaluateCondition(value, cond) {
  const { op, value: target } = cond;
  if (op == null) return false;

  // Comparison ops work for numbers + strings
  switch (op) {
    case '=':
    case '==':
      return String(value) === String(target);
    case '!=':
      return String(value) !== String(target);
    case '>':
      return toNum(value) > toNum(target);
    case '>=':
      return toNum(value) >= toNum(target);
    case '<':
      return toNum(value) < toNum(target);
    case '<=':
      return toNum(value) <= toNum(target);
    case 'contains':
      return String(value || '').toLowerCase().includes(String(target).toLowerCase());
    case 'starts_with':
      return String(value || '').toLowerCase().startsWith(String(target).toLowerCase());
    case 'in': {
      const list = Array.isArray(target) ? target : [target];
      return list.some(t => String(value) === String(t));
    }
    default:
      return false;
  }
}

function aggregateValues(values, fn) {
  const valid = values.filter(v => v != null && Number.isFinite(v));
  if (!valid.length) return null;
  switch (fn) {
    case 'SUM':   return valid.reduce((a, b) => a + b, 0);
    case 'AVG':   return valid.reduce((a, b) => a + b, 0) / valid.length;
    case 'COUNT': return valid.length;
    case 'MIN':   return Math.min(...valid);
    case 'MAX':   return Math.max(...valid);
    case 'MEDIAN': {
      const sorted = [...valid].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    default: return null;
  }
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { applySets };
