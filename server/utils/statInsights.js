/**
 * statInsights — given chart data and a focus, return a single-sentence
 * finding driven by real statistics (not LLM prose).
 *
 * Each insight has: { headline, severity, statistic, evidence }
 *   - headline: 1 sentence the UI shows
 *   - severity: 'info' | 'notable' | 'critical' — drives styling
 *   - statistic: the underlying number for "explore further"
 *   - evidence: structured backup data so the user can drill in
 *
 * The insight types map to the focuses defined by autoDashboard:
 *   - kpi → just the value with a comparison to historical average if possible
 *   - trend → direction + magnitude + R² confidence
 *   - distribution → top contributor share, dispersion
 *   - concentration → Pareto ratio (does top-X account for Y% of total?)
 *   - spread → IQR, outlier count
 *   - correlation → Pearson r + interpretation
 *   - share → biggest slice + dominance
 *
 * Conservative tone: state facts, don't editorialize. "Top 5 customers
 * account for 47% of total revenue" — not "Your customer base is dangerously
 * concentrated."
 */

// ─── HELPERS ────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function sortDesc(arr, key) {
  return [...arr].sort((a, b) => (num(b[key]) ?? -Infinity) - (num(a[key]) ?? -Infinity));
}

function formatNum(v, opts = {}) {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (opts.percent) return v.toFixed(1) + '%';
  if (abs >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B';
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (abs >= 1_000) return (v / 1_000).toFixed(1) + 'K';
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(2).replace(/\.?0+$/, '');
}

function pct(num, den) {
  if (!den || den === 0) return null;
  return (num / den) * 100;
}

// ─── INSIGHT GENERATORS BY FOCUS ────────────────────────────────────────────

function distributionInsight({ chartData, dimKey, valueKey }) {
  if (!Array.isArray(chartData) || !chartData.length || !dimKey || !valueKey) return null;
  const sorted = sortDesc(chartData, valueKey);
  const total = chartData.reduce((s, r) => s + (num(r[valueKey]) || 0), 0);
  if (total === 0) return null;

  const top = sorted[0];
  const topShare = pct(num(top[valueKey]), total);
  const top3Sum = sorted.slice(0, 3).reduce((s, r) => s + (num(r[valueKey]) || 0), 0);
  const top3Share = pct(top3Sum, total);

  // Decide which fact is more interesting
  if (topShare != null && topShare >= 40) {
    return {
      headline: `${top[dimKey]} accounts for ${formatNum(topShare, { percent: true })} of total ${valueKey}`,
      severity: topShare >= 60 ? 'notable' : 'info',
      statistic: { topValue: top[dimKey], topShare, total },
      evidence: { top3Share, ranked: sorted.slice(0, 5) },
    };
  }

  if (top3Share != null && chartData.length >= 5) {
    return {
      headline: `Top 3 ${dimKey} contribute ${formatNum(top3Share, { percent: true })} of total`,
      severity: top3Share >= 70 ? 'notable' : 'info',
      statistic: { top3Share, total },
      evidence: { ranked: sorted.slice(0, 5) },
    };
  }

  return {
    headline: `${chartData.length} ${dimKey} categories — most equally distributed`,
    severity: 'info',
    statistic: { count: chartData.length, total },
    evidence: { ranked: sorted.slice(0, 5) },
  };
}

function concentrationInsight({ chartData, dimKey, valueKey, totalRows }) {
  if (!Array.isArray(chartData) || !chartData.length || !dimKey || !valueKey) return null;
  const sorted = sortDesc(chartData, valueKey);
  const total = chartData.reduce((s, r) => s + (num(r[valueKey]) || 0), 0);
  if (total === 0) return null;

  // Pareto check: do top 20% account for 80% of total?
  const topNCount = Math.max(1, Math.ceil(sorted.length * 0.2));
  const topNSum = sorted.slice(0, topNCount).reduce((s, r) => s + (num(r[valueKey]) || 0), 0);
  const topNShare = pct(topNSum, total);

  // Top-5 share is more interpretable for the headline
  const top5Sum = sorted.slice(0, 5).reduce((s, r) => s + (num(r[valueKey]) || 0), 0);
  const top5Share = pct(top5Sum, total);

  if (top5Share != null) {
    return {
      headline: `Top 5 ${dimKey} = ${formatNum(top5Share, { percent: true })} of total ${valueKey}`,
      severity: top5Share >= 70 ? 'notable' : 'info',
      statistic: { top5Share, top5Sum, total, topNShare, paretoRatio: topNShare },
      evidence: { ranked: sorted.slice(0, 10) },
    };
  }
  return null;
}

function trendInsight({ chartData, dateKey, valueKey }) {
  if (!Array.isArray(chartData) || chartData.length < 3 || !dateKey || !valueKey) return null;
  const points = chartData
    .map(r => ({ x: r[dateKey], y: num(r[valueKey]) }))
    .filter(p => p.y != null);
  if (points.length < 3) return null;

  // Treat x as sequential index (we trust the chart ordering)
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.y);

  // Linear regression
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num1 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num1 += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num1 / den;
  const intercept = meanY - slope * meanX;

  // R² for confidence
  const yPred = xs.map(x => intercept + slope * x);
  const ssRes = ys.reduce((s, y, i) => s + (y - yPred[i]) ** 2, 0);
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Total change start to end
  const first = ys[0];
  const last = ys[ys.length - 1];
  const change = last - first;
  const pctChange = first !== 0 ? (change / Math.abs(first)) * 100 : null;

  // Direction
  let direction;
  if (Math.abs(slope) < (Math.abs(meanY) * 0.005)) direction = 'flat';
  else if (slope > 0) direction = 'rising';
  else direction = 'falling';

  let headline;
  if (direction === 'flat') {
    headline = `${valueKey} is roughly flat across the period`;
  } else if (pctChange != null) {
    const sign = pctChange >= 0 ? '+' : '';
    headline = `${valueKey} ${direction} ${sign}${formatNum(pctChange, { percent: true })} from ${formatNum(first)} to ${formatNum(last)}`;
  } else {
    headline = `${valueKey} is ${direction} (slope ${formatNum(slope)} per period)`;
  }

  return {
    headline,
    severity: Math.abs(pctChange ?? 0) >= 20 ? 'notable' : 'info',
    statistic: { slope, r2, pctChange, first, last, direction },
    evidence: { points: points.slice(0, 50) },
  };
}

function spreadInsight({ chartData, valueKey, columnStats }) {
  // Distribution histogram — use either the chart bins or pre-computed stats
  if (columnStats?.median != null) {
    const stats = columnStats;
    const skewness = stats.skewness;
    let shape = 'roughly symmetric';
    if (Math.abs(skewness) >= 1) shape = skewness > 0 ? 'right-skewed' : 'left-skewed';
    else if (Math.abs(skewness) >= 0.3) shape = skewness > 0 ? 'mildly right-skewed' : 'mildly left-skewed';

    const outlierCount = stats.outlierCount || 0;
    if (outlierCount > 0) {
      return {
        headline: `${valueKey} is ${shape} with ${outlierCount} outlier${outlierCount === 1 ? '' : 's'} (median ${formatNum(stats.median)})`,
        severity: outlierCount > stats.count * 0.05 ? 'notable' : 'info',
        statistic: { median: stats.median, mean: stats.mean, stdDev: stats.stdDev, outlierCount, skewness },
        evidence: { iqr: stats.iqr, q1: stats.q1, q3: stats.q3 },
      };
    }
    return {
      headline: `${valueKey} is ${shape} (median ${formatNum(stats.median)}, IQR ${formatNum(stats.iqr)})`,
      severity: 'info',
      statistic: { median: stats.median, mean: stats.mean, stdDev: stats.stdDev, skewness },
      evidence: { iqr: stats.iqr, q1: stats.q1, q3: stats.q3 },
    };
  }
  return null;
}

function correlationInsight({ chartData, xKey, yKey }) {
  if (!Array.isArray(chartData) || chartData.length < 5) return null;
  const xs = []; const ys = [];
  for (const r of chartData) {
    const x = num(r[xKey]);
    const y = num(r[yKey]);
    if (x != null && y != null) { xs.push(x); ys.push(y); }
  }
  if (xs.length < 5) return null;

  const meanX = xs.reduce((s, v) => s + v, 0) / xs.length;
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  let cov = 0, varX = 0, varY = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    cov += dx * dy; varX += dx * dx; varY += dy * dy;
  }
  if (varX === 0 || varY === 0) return null;
  const r = cov / Math.sqrt(varX * varY);

  const absR = Math.abs(r);
  let strength;
  if (absR < 0.2) strength = 'no clear';
  else if (absR < 0.4) strength = 'weak';
  else if (absR < 0.7) strength = 'moderate';
  else strength = 'strong';
  const direction = r > 0 ? 'positive' : 'negative';

  let headline;
  if (strength === 'no clear') {
    headline = `No clear relationship between ${xKey} and ${yKey} (r=${r.toFixed(2)})`;
  } else {
    headline = `${capitalize(strength)} ${direction} relationship: ${xKey} vs ${yKey} (r=${r.toFixed(2)})`;
  }

  return {
    headline,
    severity: absR >= 0.7 ? 'notable' : 'info',
    statistic: { r, n: xs.length, strength, direction },
    evidence: { sampleSize: xs.length },
  };
}

function shareInsight({ chartData, dimKey, valueKey }) {
  return distributionInsight({ chartData, dimKey, valueKey });
}

function kpiInsight({ chartData, valueKey, columnStats }) {
  if (!Array.isArray(chartData) || !chartData.length) return null;
  const value = num(chartData[0]?.[valueKey] ?? chartData[0]?.value);
  if (value == null) return null;
  return {
    headline: `${valueKey}: ${formatNum(value)}`,
    severity: 'info',
    statistic: { value },
    evidence: columnStats ? { mean: columnStats.mean, median: columnStats.median, stdDev: columnStats.stdDev } : {},
  };
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ─── DISPATCH ────────────────────────────────────────────────────────────────

/**
 * Generate an insight for a chart based on its focus.
 *
 * @param chartData    rendered chart data
 * @param focus        one of: kpi, trend, distribution, concentration, spread, correlation, share
 * @param keys         { dimKey, valueKey, dateKey, xKey, yKey } — varies by focus
 * @param columnStats  pre-computed stats from the dataset analysis (for spread/kpi)
 */
function forChart({ chartData, focus, keys = {}, columnStats }) {
  if (!chartData) return null;
  switch (focus) {
    case 'kpi':           return kpiInsight({ chartData, ...keys, columnStats });
    case 'trend':         return trendInsight({ chartData, ...keys });
    case 'distribution':  return distributionInsight({ chartData, ...keys });
    case 'concentration': return concentrationInsight({ chartData, ...keys });
    case 'spread':        return spreadInsight({ chartData, ...keys, columnStats });
    case 'correlation':   return correlationInsight({ chartData, ...keys });
    case 'share':         return shareInsight({ chartData, ...keys });
    default: return null;
  }
}

module.exports = {
  forChart,
  // Exposed for tests
  _trendInsight: trendInsight,
  _distributionInsight: distributionInsight,
  _correlationInsight: correlationInsight,
  _concentrationInsight: concentrationInsight,
  _spreadInsight: spreadInsight,
};
