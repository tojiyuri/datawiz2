/**
 * Reference lines & bands.
 *
 * Overlay horizontal/vertical lines and shaded regions on cartesian charts.
 * Two flavours:
 *
 *   1. Lines: a single value drawn as a line across the chart (avg, target, etc.)
 *   2. Bands: a shaded region between two values (e.g., normal range, 95% CI)
 *
 * Definition shapes:
 *
 *   referenceLines: [
 *     { label: 'Average', value: 'avg', axis: 'y', stroke: '#E9A521' },
 *     { label: 'Target', value: 1000, axis: 'y' },
 *     { label: 'P95', value: 'p95', axis: 'y' },
 *   ]
 *
 *   referenceBands: [
 *     { label: 'Normal range', from: 'p25', to: 'p75', axis: 'y' },
 *     { label: 'Acceptable', from: 800, to: 1200, axis: 'y' },
 *   ]
 *
 * Magic values for `value`/`from`/`to`:
 *   - 'avg' / 'mean'  → arithmetic mean of the y-axis values
 *   - 'median'        → 50th percentile
 *   - 'p25', 'p75', 'p90', 'p95', 'p99'  → percentiles
 *   - 'min', 'max'    → extremes
 *   - 'sum'           → total (rare; usually meaningless on a y-axis)
 *   - <number>        → literal value
 *
 * The resolveReferenceLines function turns the spec-level definitions into
 * concrete numeric values that ChartRenderer can pass to recharts'
 * <ReferenceLine value=...> directly.
 */

function resolveReferenceLines(referenceLines, chartData, valueKey) {
  if (!Array.isArray(referenceLines) || !referenceLines.length || !Array.isArray(chartData)) {
    return [];
  }
  const values = chartData.map(r => toNum(r[valueKey])).filter(v => v != null);
  return referenceLines
    .map(line => {
      const numeric = computeReferenceValue(line.value, values);
      if (numeric == null) return null;
      return { ...line, value: numeric };
    })
    .filter(Boolean);
}

function resolveReferenceBands(referenceBands, chartData, valueKey) {
  if (!Array.isArray(referenceBands) || !referenceBands.length || !Array.isArray(chartData)) {
    return [];
  }
  const values = chartData.map(r => toNum(r[valueKey])).filter(v => v != null);
  return referenceBands
    .map(band => {
      const from = computeReferenceValue(band.from, values);
      const to = computeReferenceValue(band.to, values);
      if (from == null || to == null) return null;
      // Always normalize so from < to
      return { ...band, from: Math.min(from, to), to: Math.max(from, to) };
    })
    .filter(Boolean);
}

function computeReferenceValue(spec, values) {
  if (typeof spec === 'number') return spec;
  if (typeof spec !== 'string') return null;
  if (!values.length) return null;

  const lower = spec.toLowerCase().trim();

  // Numeric string
  const asNum = parseFloat(lower);
  if (Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(lower)) return asNum;

  switch (lower) {
    case 'avg':
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'median':
      return percentile(values, 50);
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    default: {
      // pNN form
      const pMatch = lower.match(/^p(\d+(?:\.\d+)?)$/);
      if (pMatch) {
        const pct = parseFloat(pMatch[1]);
        if (pct >= 0 && pct <= 100) return percentile(values, pct);
      }
      return null;
    }
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

module.exports = {
  resolveReferenceLines,
  resolveReferenceBands,
  computeReferenceValue,
  percentile,
};
