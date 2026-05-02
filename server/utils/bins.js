/**
 * Bins / auto-bucketing.
 *
 * Group continuous numeric values into discrete ranges. Three strategies:
 *
 *   1. equal-width: range / N. Predictable, easy to read.
 *   2. equal-count (quantile): each bin has ~equal number of rows. Better for
 *      skewed distributions.
 *   3. custom: user-supplied edges, e.g. [0, 18, 35, 50, 65, 100] for age groups.
 *
 * Bins create a new derived column on every row with the bucket label.
 * They're a row-level transformation — applied BEFORE aggregation, just like
 * calculated fields.
 *
 * Bin definition shape:
 *   { name, source, strategy, count?, edges?, includeUpper? }
 *
 * Examples:
 *   { name: 'Age Group', source: 'Age', strategy: 'equal-width', count: 5 }
 *   { name: 'Sales Tier', source: 'Sales', strategy: 'quantile', count: 4 }   // quartiles
 *   { name: 'Custom', source: 'Score', strategy: 'custom', edges: [0, 50, 75, 90, 100] }
 *
 * Output labels by default: "0–20", "20–40", etc. Custom labels via `labels` array.
 */

function suggestBins(values, count = 5) {
  const nums = values.map(toNum).filter(v => v != null);
  if (!nums.length) return null;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return null;
  return {
    min,
    max,
    suggestedCount: count,
    suggestedWidth: niceStep((max - min) / count),
  };
}

function applyBins(data, binDefs) {
  if (!Array.isArray(binDefs) || !binDefs.length) return data;
  // We don't mutate the input — return a new array of new objects
  const out = data.map(r => ({ ...r }));
  for (const def of binDefs) {
    if (!def?.name || !def?.source) continue;
    try { applyOne(out, def); }
    catch (err) {
      console.warn(`[bins] ${def.name}: ${err.message}`);
      out.forEach(r => { r[def.name] = null; });
    }
  }
  return out;
}

function applyOne(rows, def) {
  const { name, source, strategy = 'equal-width', count = 5, edges, labels, includeUpper = true } = def;

  let bins;
  if (strategy === 'custom') {
    if (!Array.isArray(edges) || edges.length < 2) {
      throw new Error('custom strategy needs edges of length >= 2');
    }
    bins = makeBinsFromEdges([...edges].sort((a, b) => a - b), labels, includeUpper);
  } else if (strategy === 'quantile') {
    const values = rows.map(r => toNum(r[source])).filter(v => v != null).sort((a, b) => a - b);
    if (!values.length) throw new Error(`no numeric data in column '${source}'`);
    const computed = [];
    for (let i = 0; i <= count; i++) {
      const idx = Math.min(values.length - 1, Math.floor((i / count) * values.length));
      computed.push(values[idx]);
    }
    // Dedupe edges (when there are ties at quantile boundaries)
    const uniq = Array.from(new Set(computed));
    if (uniq.length < 2) throw new Error('not enough variation for quantile bins');
    bins = makeBinsFromEdges(uniq, labels, includeUpper);
  } else {
    // equal-width
    const values = rows.map(r => toNum(r[source])).filter(v => v != null);
    if (!values.length) throw new Error(`no numeric data in column '${source}'`);
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) throw new Error('all values are equal — no range to bin');
    const step = (max - min) / count;
    const computed = [];
    for (let i = 0; i <= count; i++) computed.push(min + i * step);
    bins = makeBinsFromEdges(computed, labels, includeUpper);
  }

  // Assign each row to a bin
  for (const r of rows) {
    const v = toNum(r[source]);
    if (v == null) { r[name] = null; continue; }
    r[name] = labelFor(v, bins);
  }
}

function makeBinsFromEdges(edges, labels, includeUpper) {
  const result = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const isLast = i === edges.length - 2;
    const lbl = (labels && labels[i]) || formatLabel(lo, hi);
    result.push({ lo, hi, isLast, label: lbl, includeUpper: includeUpper && isLast });
  }
  return result;
}

function labelFor(v, bins) {
  for (const b of bins) {
    // Standard binning: [lo, hi). Last bin is [lo, hi] when includeUpper.
    if (v >= b.lo && (b.includeUpper ? v <= b.hi : v < b.hi)) return b.label;
  }
  // Outside the defined range
  if (v < bins[0].lo) return `< ${formatNum(bins[0].lo)}`;
  return `≥ ${formatNum(bins[bins.length - 1].hi)}`;
}

function formatLabel(lo, hi) {
  return `${formatNum(lo)}–${formatNum(hi)}`;
}

function formatNum(n) {
  if (n == null || !Number.isFinite(n)) return '?';
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString();
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

// Round to a "nice" round number for default bin widths
function niceStep(approx) {
  if (approx <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(approx)));
  const f = approx / exp;
  let nice;
  if (f < 1.5) nice = 1;
  else if (f < 3) nice = 2;
  else if (f < 7) nice = 5;
  else nice = 10;
  return nice * exp;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = { applyBins, suggestBins };
