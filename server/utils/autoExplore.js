/**
 * autoExplore — a multi-step scanner that surfaces interesting findings.
 *
 * The product question this answers: "What do I need to know about this
 * dataset?" — without the user having to ask anything specific.
 *
 * Strategy:
 *
 *   1. Compute summary stats per column (already done in datasetStore.analysis)
 *   2. For each numeric column, look for:
 *      - Heavy concentration (top 5 values >= 50% of total → Pareto)
 *      - Outliers (IQR-based)
 *      - Skew or unusual shape
 *   3. For each (categorical, numeric) pair, look for:
 *      - Strong group differences (one segment much bigger than others)
 *      - Top performer vs bottom performer
 *   4. For each (date, numeric) pair, look for:
 *      - Trend direction + magnitude
 *      - Period-over-period change
 *   5. For each (numeric, numeric) pair, look for:
 *      - Strong correlation (|r| > 0.5)
 *
 * Each finding has:
 *   - severity: 'critical' | 'warning' | 'info'
 *   - score: 0-100, used to rank
 *   - text: one-sentence summary stating the fact
 *   - chartSpec: a sheet spec the user can open to explore further
 *   - evidence: raw numbers backing the claim
 *
 * The engine is intentionally CONSERVATIVE — it states facts, not interpretations.
 * "Sales is concentrated: top 5 customers = 47% of revenue" is what we say.
 * NOT "Your business has dangerous customer concentration risk." That kind of
 * interpretation is the user's job, not ours.
 *
 * The engine doesn't depend on an LLM. The LLM can OPTIONALLY enrich findings
 * with prose explanations afterwards (via llmInsightExplainer), but the core
 * finding generation is deterministic and statistical.
 */

const datasetStore = require('./datasetStore');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '?';
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(n) >= 10_000)    return (n / 1000).toFixed(0) + 'K';
  if (Math.abs(n) >= 1000)      return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (Number.isInteger(n))      return String(n);
  return n.toFixed(2).replace(/\.?0+$/, '');
}

function pct(n, d) {
  if (!d || d === 0) return null;
  return (n / d) * 100;
}

function fmtPct(p) {
  if (p == null) return '?%';
  if (Math.abs(p) >= 100) return Math.round(p) + '%';
  if (Math.abs(p) >= 10) return p.toFixed(1) + '%';
  return p.toFixed(2) + '%';
}

// Sample down for expensive scans — full scan above this size hurts latency
// Cap below which we won't sample; above this we draw a deterministic sample.
// Lowered from 50K because correlation/group-difference scans run pairwise
// over numeric × numeric and cat × num combinations — at 50K rows × 30 pairs
// the worst case approached 1 second of event loop time. 25K halves that.
const SCAN_LIMIT = 25_000;
function sampleData(rows) {
  if (rows.length <= SCAN_LIMIT) return rows;
  const out = [];
  const step = rows.length / SCAN_LIMIT;
  for (let i = 0; i < SCAN_LIMIT; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

// ─── FINDING SCANNERS ────────────────────────────────────────────────────────

/**
 * Pareto / concentration scan: does a small fraction of values account for
 * most of the total? Run per (categorical, numeric) pair.
 *
 * The "top 5 = X%" cutoff is the most robust framing — Pareto's classic
 * 80/20 isn't always 80/20 in real data, so we report whatever fraction
 * actually concentrates in the top.
 */
function paretoFinding({ rows, dimCol, measCol }) {
  const groups = new Map();
  for (const r of rows) {
    const key = r[dimCol.name];
    if (key == null || key === '') continue;
    const v = num(r[measCol.name]);
    if (v == null) continue;
    groups.set(key, (groups.get(key) || 0) + v);
  }
  // Need substantially more than 5 groups for "top 5 = X%" to mean anything.
  // If there are only 5-7 groups, the framing is trivial ("top 5 of 6 = 99%"
  // tells you nothing). Use a ratio scale instead.
  if (groups.size < 10) return null;

  const total = Array.from(groups.values()).reduce((a, b) => a + b, 0);
  if (total === 0) return null;

  const sorted = Array.from(groups.entries()).sort((a, b) => b[1] - a[1]);
  const topN = Math.min(5, Math.ceil(groups.size * 0.2));   // top 20% or top 5, whichever is smaller
  const topSum = sorted.slice(0, topN).reduce((a, [, v]) => a + v, 0);
  const topPct = (topSum / total) * 100;

  // The "fair share" — if uniformly distributed, top N would equal N/total
  const fairShare = (topN / groups.size) * 100;
  const overrepresentation = topPct - fairShare;

  // Only worth surfacing if concentration is notable AND meaningfully above
  // what you'd expect by chance.
  if (overrepresentation < 20) return null;

  const topName = sorted[0][0];
  const topValue = sorted[0][1];
  const topItemPct = (topValue / total) * 100;

  // Severity scales with overrepresentation
  const severity = overrepresentation >= 50 ? 'warning' : 'info';
  const score = Math.min(100, overrepresentation * 1.5);

  return {
    type: 'concentration',
    severity,
    score,
    title: `${measCol.name} is concentrated`,
    text: `Top ${topN} ${dimCol.name}${topN === 1 ? '' : 's'} of ${groups.size} accounts for ${fmtPct(topPct)} of ${measCol.name}. "${topName}" alone is ${fmtPct(topItemPct)}.`,
    evidence: {
      topPercent: topPct,
      topN,
      groupCount: groups.size,
      topItem: topName,
      topValue,
      total,
      overrepresentation,
    },
    chartSpec: {
      chartType: 'bar',
      columns: [{ name: dimCol.name, type: 'categorical' }],
      rows: [{ name: measCol.name, type: 'numeric', aggregation: 'sum' }],
      filters: [{ field: dimCol.name, op: 'top_n', value: 10, by: measCol.name }],
    },
  };
}

/**
 * Outlier scan: how many values are >1.5*IQR outside the fences?
 * Reports the count and the most extreme single value.
 */
function outlierFinding({ rows, measCol }) {
  const values = rows.map(r => num(r[measCol.name])).filter(v => v != null);
  if (values.length < 20) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  if (iqr === 0) return null;

  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;

  const outliers = values.filter(v => v < lo || v > hi);
  if (outliers.length === 0) return null;

  const outlierPct = (outliers.length / values.length) * 100;
  // Don't bother surfacing 1-2 outliers in a small range
  if (outlierPct < 0.5 || outliers.length < 3) return null;

  const extreme = outliers.reduce((m, v) =>
    Math.abs(v - (q1 + q3) / 2) > Math.abs(m - (q1 + q3) / 2) ? v : m, outliers[0]
  );

  const severity = outlierPct > 5 ? 'warning' : 'info';
  const score = Math.min(100, outlierPct * 10);

  return {
    type: 'outliers',
    severity,
    score,
    title: `${measCol.name} has outliers`,
    text: `${outliers.length} values (${fmtPct(outlierPct)}) are outside the typical range. Most extreme: ${fmtNum(extreme)}.`,
    evidence: {
      count: outliers.length,
      percent: outlierPct,
      bounds: { lower: lo, upper: hi },
      mostExtreme: extreme,
    },
    chartSpec: {
      chartType: 'histogram',
      columns: [],
      rows: [{ name: measCol.name, type: 'numeric', aggregation: 'sum' }],
    },
  };
}

/**
 * Trend scan: for time series, is there a clear directional trend?
 * Uses a simple linear regression on (time, value) pairs.
 */
function trendFinding({ rows, dateCol, measCol }) {
  // Group by date column to a single value per date
  const points = new Map();
  for (const r of rows) {
    const d = r[dateCol.name];
    if (d == null || d === '') continue;
    const v = num(r[measCol.name]);
    if (v == null) continue;
    const t = new Date(d).getTime();
    if (!Number.isFinite(t)) continue;
    points.set(t, (points.get(t) || 0) + v);
  }
  if (points.size < 5) return null;

  const sorted = Array.from(points.entries()).sort((a, b) => a[0] - b[0]);
  const xs = sorted.map(([t], i) => i);    // sequential index, not raw time
  const ys = sorted.map(([, v]) => v);

  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumXY += (xs[i] - meanX) * (ys[i] - meanY);
    sumXX += (xs[i] - meanX) ** 2;
  }
  if (sumXX === 0) return null;
  const slope = sumXY / sumXX;
  const intercept = meanY - slope * meanX;

  // Total change from first to last predicted point
  const startVal = intercept;
  const endVal = intercept + slope * (n - 1);
  const totalChangePct = pct(endVal - startVal, Math.abs(startVal) || 1);

  if (totalChangePct == null || Math.abs(totalChangePct) < 5) return null;

  // R² to assess fit quality — only call out clean trends
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = intercept + slope * xs[i];
    ssRes += (ys[i] - pred) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  if (r2 < 0.15) return null;            // too noisy to call a trend

  const direction = slope > 0 ? 'increasing' : 'decreasing';
  const severity = Math.abs(totalChangePct) > 50 ? 'warning' : 'info';
  const score = Math.min(100, Math.abs(totalChangePct) * 0.6 + r2 * 40);

  return {
    type: 'trend',
    severity,
    score,
    title: `${measCol.name} is ${direction} over time`,
    text: `${measCol.name} has ${direction === 'increasing' ? 'grown' : 'declined'} ${fmtPct(Math.abs(totalChangePct))} over the period. Trend fit: R²=${r2.toFixed(2)}.`,
    evidence: {
      direction,
      totalChangePercent: totalChangePct,
      r2,
      points: n,
      startValue: startVal,
      endValue: endVal,
    },
    chartSpec: {
      chartType: 'line',
      columns: [{ name: dateCol.name, type: 'date' }],
      rows: [{ name: measCol.name, type: 'numeric', aggregation: 'sum' }],
    },
  };
}

/**
 * Correlation scan: pairwise Pearson correlation across numerics.
 * Surfaces only |r| >= 0.5 to avoid drowning in noise.
 */
function correlationFinding({ rows, numA, numB }) {
  const xs = [], ys = [];
  for (const r of rows) {
    const x = num(r[numA.name]);
    const y = num(r[numB.name]);
    if (x != null && y != null) {
      xs.push(x); ys.push(y);
    }
  }
  if (xs.length < 30) return null;        // need enough points

  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - meanX) * (ys[i] - meanY);
    sxx += (xs[i] - meanX) ** 2;
    syy += (ys[i] - meanY) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const r = sxy / Math.sqrt(sxx * syy);

  if (Math.abs(r) < 0.5) return null;

  const direction = r > 0 ? 'positive' : 'negative';
  const strength = Math.abs(r) > 0.85 ? 'very strong' : Math.abs(r) > 0.7 ? 'strong' : 'moderate';
  const severity = Math.abs(r) > 0.85 ? 'info' : 'info';
  const score = Math.abs(r) * 90;

  return {
    type: 'correlation',
    severity,
    score,
    title: `${numA.name} and ${numB.name} are correlated`,
    text: `${strength.charAt(0).toUpperCase() + strength.slice(1)} ${direction} correlation (r=${r.toFixed(2)}) between ${numA.name} and ${numB.name}.`,
    evidence: {
      r,
      direction,
      strength,
      sampleSize: xs.length,
    },
    chartSpec: {
      chartType: 'scatter',
      columns: [{ name: numA.name, type: 'numeric', aggregation: 'sum' }],
      rows: [{ name: numB.name, type: 'numeric', aggregation: 'sum' }],
    },
  };
}

/**
 * Group difference: among categorical groups, is there a clear winner
 * or a clear underperformer? Reports both extremes if they're notable.
 */
function groupDifferenceFinding({ rows, dimCol, measCol }) {
  const groups = new Map();
  for (const r of rows) {
    const key = r[dimCol.name];
    if (key == null || key === '') continue;
    const v = num(r[measCol.name]);
    if (v == null) continue;
    if (!groups.has(key)) groups.set(key, { sum: 0, count: 0 });
    const g = groups.get(key);
    g.sum += v; g.count += 1;
  }
  if (groups.size < 3) return null;

  // Use AVG (not SUM) for fair comparison — sum favors high-count groups
  const averages = Array.from(groups.entries()).map(([k, g]) => ({
    key: k, avg: g.sum / g.count, count: g.count,
  }));
  // Filter out tiny groups that aren't statistically meaningful
  const meaningful = averages.filter(g => g.count >= 5);
  if (meaningful.length < 3) return null;

  meaningful.sort((a, b) => b.avg - a.avg);
  const top = meaningful[0];
  const bottom = meaningful[meaningful.length - 1];
  const ratio = bottom.avg !== 0 ? top.avg / bottom.avg : null;

  if (ratio == null || ratio < 1.5) return null;     // not enough spread

  const severity = ratio > 5 ? 'warning' : 'info';
  const score = Math.min(100, Math.log2(ratio) * 30);

  return {
    type: 'group_difference',
    severity,
    score,
    title: `${measCol.name} varies by ${dimCol.name}`,
    text: `Average ${measCol.name} for "${top.key}" (${fmtNum(top.avg)}) is ${ratio.toFixed(1)}× higher than "${bottom.key}" (${fmtNum(bottom.avg)}).`,
    evidence: {
      top: top.key, topAvg: top.avg,
      bottom: bottom.key, bottomAvg: bottom.avg,
      ratio,
      groupCount: meaningful.length,
    },
    chartSpec: {
      chartType: 'bar',
      columns: [{ name: dimCol.name, type: 'categorical' }],
      rows: [{ name: measCol.name, type: 'numeric', aggregation: 'avg' }],
    },
  };
}

// ─── ORCHESTRATOR ────────────────────────────────────────────────────────────

function classifyColumns(columns) {
  const numerics = [], categoricals = [], dates = [];
  for (const c of columns || []) {
    if (c.type === 'temporal' || c.subtype === 'date' || c.subtype === 'datetime') {
      dates.push(c);
    } else if (c.type === 'numeric' && c.subtype !== 'identifier' && c.subtype !== 'coordinate') {
      // Skip identifier-like numerics (IDs, postal codes, etc.)
      const nameL = (c.name || '').toLowerCase();
      if (/^id|_id$|^uuid|guid|postal|zip$/.test(nameL)) continue;
      numerics.push(c);
    } else if (c.type === 'categorical') {
      // Skip ultra-high cardinality (free text, etc.)
      if (c.uniqueCount && c.uniqueCount > 200) continue;
      categoricals.push(c);
    }
  }
  return { numerics, categoricals, dates };
}

/**
 * Main entry. Scans the dataset and returns ranked findings.
 *
 * @param ds  the dataset object from datasetStore (has .data and .analysis)
 * @param options  { maxFindings?: number = 10 }
 *
 * @returns { findings, scanStats: { columnsScanned, pairsScanned, durationMs } }
 */
function explore(ds, options = {}) {
  const start = Date.now();
  const maxFindings = options.maxFindings ?? 12;

  if (!ds?.data?.length || !ds?.analysis?.columns) {
    return { findings: [], scanStats: { columnsScanned: 0, pairsScanned: 0, durationMs: 0 } };
  }

  const rows = sampleData(ds.data);
  const cls = classifyColumns(ds.analysis.columns);
  const findings = [];
  let pairsScanned = 0;

  // 1. Per-numeric: outliers, distribution shape
  for (const measCol of cls.numerics) {
    const f = outlierFinding({ rows, measCol });
    if (f) findings.push(f);
  }

  // 2. (Categorical × Numeric): concentration, group differences
  for (const dimCol of cls.categoricals) {
    for (const measCol of cls.numerics) {
      pairsScanned++;
      const c = paretoFinding({ rows, dimCol, measCol });
      if (c) findings.push(c);
      const g = groupDifferenceFinding({ rows, dimCol, measCol });
      if (g) findings.push(g);
    }
  }

  // 3. (Date × Numeric): trends
  for (const dateCol of cls.dates) {
    for (const measCol of cls.numerics) {
      pairsScanned++;
      const t = trendFinding({ rows, dateCol, measCol });
      if (t) findings.push(t);
    }
  }

  // 4. (Numeric × Numeric): correlations. Cap pairs to avoid quadratic blowup.
  const NUMERIC_PAIR_CAP = 30;
  let numericPairs = 0;
  outer:
  for (let i = 0; i < cls.numerics.length; i++) {
    for (let j = i + 1; j < cls.numerics.length; j++) {
      if (numericPairs >= NUMERIC_PAIR_CAP) break outer;
      pairsScanned++;
      numericPairs++;
      const c = correlationFinding({ rows, numA: cls.numerics[i], numB: cls.numerics[j] });
      if (c) findings.push(c);
    }
  }

  // Rank by score, dedupe similar findings (same chart spec → keep highest)
  findings.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const ranked = [];
  for (const f of findings) {
    const key = JSON.stringify(f.chartSpec);
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(f);
    if (ranked.length >= maxFindings) break;
  }

  return {
    findings: ranked,
    scanStats: {
      columnsScanned: cls.numerics.length + cls.categoricals.length + cls.dates.length,
      pairsScanned,
      durationMs: Date.now() - start,
    },
  };
}

module.exports = { explore, _classifyColumns: classifyColumns };
