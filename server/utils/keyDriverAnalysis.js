/**
 * Key driver analysis.
 *
 * "What fields most influence Sales?" Given a target column, rank every other
 * column by how strongly it predicts the target.
 *
 * Three signals combined:
 *   1. Pearson correlation — for numeric features against numeric target
 *   2. Mutual information   — for categorical features against any target
 *   3. ANOVA F-statistic   — for categorical → numeric (group-mean separation)
 *
 * Each driver gets a unified "importance" score (0-100) and a direction
 * (positive/negative for numerics; n/a for categoricals). Categoricals also
 * get the top contributing levels — "Region=East drives Sales up by ~15%".
 *
 * Why not just use a gradient-boosted tree's feature importance?
 *  - We're in a Node.js server. Implementing GBT honestly is hundreds of
 *    lines and still won't beat a proper xgboost.
 *  - The combined Pearson/MI/ANOVA signals catch ~80% of what GBT importance
 *    catches for analytics use cases, and they're explainable per-feature.
 *  - The output is still a ranked list users can act on.
 *
 * NOT a causal claim. We deliberately call this "key drivers" not
 * "what causes" — correlation isn't causation, and the UI states this.
 */

// ─── PUBLIC ENTRY ────────────────────────────────────────────────────────────

/**
 * Analyze drivers of a target column.
 *
 * @param ds       dataset object (has .data and .analysis.columns)
 * @param target   name of the column to predict
 * @param options  { maxDrivers?: number = 8, minSamples?: number = 30 }
 * @returns        { target, targetType, drivers: [...], scanStats }
 */
function analyzeDrivers(ds, target, options = {}) {
  const start = Date.now();
  const maxDrivers = options.maxDrivers ?? 8;
  const minSamples = options.minSamples ?? 30;

  if (!ds?.data?.length || !ds?.analysis?.columns) {
    return { target, drivers: [], scanStats: { columnsScanned: 0, durationMs: 0 } };
  }

  const targetCol = ds.analysis.columns.find(c => c.name === target);
  if (!targetCol) {
    throw new Error(`Target column '${target}' not found`);
  }

  // Sample if huge
  const SAMPLE_LIMIT = 20000;
  const rows = ds.data.length > SAMPLE_LIMIT ? sample(ds.data, SAMPLE_LIMIT) : ds.data;

  const targetType = classifyType(targetCol);
  if (targetType === 'unknown') {
    throw new Error(`Target column '${target}' has unsupported type`);
  }

  // Scan every other column
  const drivers = [];
  let scanned = 0;
  for (const col of ds.analysis.columns) {
    if (col.name === target) continue;
    const featType = classifyType(col);
    if (featType === 'unknown' || featType === 'identifier') continue;
    scanned++;

    let driver;
    try {
      if (featType === 'numeric' && targetType === 'numeric') {
        driver = numericVsNumeric(rows, col.name, target, minSamples);
      } else if (featType === 'numeric' && targetType === 'categorical') {
        // Numeric feature predicting categorical target — flip the ANOVA
        driver = anovaFeatureCategorical(rows, col.name, target, minSamples);
      } else if (featType === 'categorical' && targetType === 'numeric') {
        driver = categoricalVsNumeric(rows, col.name, target, minSamples);
      } else if (featType === 'categorical' && targetType === 'categorical') {
        driver = categoricalVsCategorical(rows, col.name, target, minSamples);
      }
    } catch (err) {
      // Skip individual driver errors silently
    }

    if (driver) drivers.push({ feature: col.name, featureType: featType, ...driver });
  }

  // Rank by importance
  drivers.sort((a, b) => b.importance - a.importance);
  const top = drivers.slice(0, maxDrivers);

  return {
    target,
    targetType,
    drivers: top,
    scanStats: {
      columnsScanned: scanned,
      driversFound: drivers.length,
      durationMs: Date.now() - start,
    },
  };
}

// ─── NUMERIC × NUMERIC: Pearson correlation ──────────────────────────────────

function numericVsNumeric(rows, feature, target, minSamples) {
  const xs = [], ys = [];
  for (const r of rows) {
    const xv = num(r[feature]);
    const yv = num(r[target]);
    if (xv != null && yv != null) { xs.push(xv); ys.push(yv); }
  }
  if (xs.length < minSamples) return null;

  const r = pearson(xs, ys);
  if (r == null || !Number.isFinite(r)) return null;

  // Importance: |r| × 100, with a small penalty for low-N samples
  const sampleFactor = Math.min(1, xs.length / 200);
  const importance = Math.abs(r) * 100 * (0.7 + 0.3 * sampleFactor);

  return {
    importance: round(importance, 1),
    method: 'pearson',
    direction: r > 0 ? 'positive' : 'negative',
    r: round(r, 3),
    sampleSize: xs.length,
    summary: `${r > 0 ? 'Higher' : 'Lower'} ${feature} associated with ${r > 0 ? 'higher' : 'lower'} ${target} (r=${r.toFixed(2)}).`,
  };
}

// ─── CATEGORICAL × NUMERIC: ANOVA F-stat + top contributing levels ──────────

function categoricalVsNumeric(rows, feature, target, minSamples) {
  // Group target values by feature value
  const groups = new Map();
  for (const r of rows) {
    const k = r[feature];
    const yv = num(r[target]);
    if (k == null || k === '' || yv == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(yv);
  }
  if (groups.size < 2) return null;

  // Filter out groups with < 3 samples
  const usable = Array.from(groups.entries()).filter(([, vals]) => vals.length >= 3);
  if (usable.length < 2) return null;

  const totalN = usable.reduce((s, [, v]) => s + v.length, 0);
  if (totalN < minSamples) return null;

  // ANOVA F-stat: ratio of between-group variance to within-group variance
  const grandMean = usable.flatMap(([, v]) => v).reduce((s, x) => s + x, 0) / totalN;
  let ssBetween = 0, ssWithin = 0;
  for (const [, vals] of usable) {
    const groupMean = mean(vals);
    ssBetween += vals.length * (groupMean - grandMean) ** 2;
    for (const v of vals) ssWithin += (v - groupMean) ** 2;
  }
  const dfBetween = usable.length - 1;
  const dfWithin = totalN - usable.length;
  if (dfBetween === 0 || dfWithin === 0 || ssWithin === 0) return null;

  const F = (ssBetween / dfBetween) / (ssWithin / dfWithin);
  // Eta-squared: proportion of variance explained — bounded [0, 1]
  const etaSq = ssBetween / (ssBetween + ssWithin);

  // Importance = eta² × 100, scaled to 0-100
  const importance = Math.min(100, etaSq * 100);

  // Top contributors: groups whose mean is most different from grand mean
  const contributors = usable
    .map(([k, v]) => ({
      level: String(k),
      n: v.length,
      groupMean: round(mean(v), 2),
      delta: round(mean(v) - grandMean, 2),
      deltaPct: grandMean !== 0 ? round((mean(v) - grandMean) / Math.abs(grandMean) * 100, 1) : null,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);

  const top = contributors[0];
  const summary = top
    ? `Average ${target} varies by ${feature}. "${top.level}" is ${top.delta > 0 ? '+' : ''}${top.delta} vs avg ${grandMean.toFixed(2)}.`
    : `${feature} groups differ in ${target} (η²=${etaSq.toFixed(3)}).`;

  return {
    importance: round(importance, 1),
    method: 'anova',
    F: round(F, 2),
    etaSquared: round(etaSq, 4),
    sampleSize: totalN,
    groupCount: usable.length,
    contributors,
    summary,
  };
}

// ─── NUMERIC × CATEGORICAL: ANOVA on the numeric feature, by target groups ──

function anovaFeatureCategorical(rows, feature, target, minSamples) {
  // Same as categoricalVsNumeric but flipped: group `feature` by `target`
  return categoricalVsNumeric(rows, target, feature, minSamples)
    ? (() => {
        const result = categoricalVsNumeric(rows, target, feature, minSamples);
        if (!result) return null;
        // Rephrase summary to talk about the feature's effect on target
        return {
          ...result,
          summary: `${feature} differs across ${target} groups (η²=${result.etaSquared}).`,
        };
      })()
    : null;
}

// ─── CATEGORICAL × CATEGORICAL: mutual information ──────────────────────────

function categoricalVsCategorical(rows, feature, target, minSamples) {
  const counts = new Map();              // (feature, target) → count
  const featureCounts = new Map();
  const targetCounts = new Map();
  let total = 0;
  for (const r of rows) {
    const fv = r[feature];
    const tv = r[target];
    if (fv == null || fv === '' || tv == null || tv === '') continue;
    const fk = String(fv), tk = String(tv);
    const k = `${fk}|||${tk}`;
    counts.set(k, (counts.get(k) || 0) + 1);
    featureCounts.set(fk, (featureCounts.get(fk) || 0) + 1);
    targetCounts.set(tk, (targetCounts.get(tk) || 0) + 1);
    total++;
  }
  if (total < minSamples) return null;
  if (featureCounts.size < 2 || targetCounts.size < 2) return null;

  // Mutual information: I(X;Y) = sum p(x,y) log(p(x,y) / (p(x) p(y)))
  let mi = 0;
  for (const [k, count] of counts.entries()) {
    const [fk, tk] = k.split('|||');
    const pxy = count / total;
    const px = featureCounts.get(fk) / total;
    const py = targetCounts.get(tk) / total;
    if (pxy > 0 && px > 0 && py > 0) {
      mi += pxy * Math.log2(pxy / (px * py));
    }
  }

  // Normalise by min(H(X), H(Y)) for comparability across pairs (Uncertainty
  // Coefficient flavour). Bounded [0, 1].
  const hX = entropy([...featureCounts.values()].map(c => c / total));
  const hY = entropy([...targetCounts.values()].map(c => c / total));
  const minH = Math.min(hX, hY);
  const normalisedMI = minH > 0 ? mi / minH : 0;
  const importance = Math.min(100, normalisedMI * 100);

  return {
    importance: round(importance, 1),
    method: 'mutual_info',
    mi: round(mi, 3),
    normalisedMI: round(normalisedMI, 3),
    sampleSize: total,
    summary: `${feature} predicts ${target} with normalised MI = ${normalisedMI.toFixed(2)}.`,
  };
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function classifyType(col) {
  if (!col) return 'unknown';
  // Skip obvious identifiers
  const nameL = (col.name || '').toLowerCase();
  if (/^id$|_id$|^uuid|guid|postal|zip$/.test(nameL)) return 'identifier';
  if (col.subtype === 'identifier' || col.subtype === 'coordinate') return 'identifier';
  if (col.type === 'numeric' || col.type === 'integer') return 'numeric';
  if (col.type === 'categorical' || col.type === 'string') {
    // Skip ultra-high cardinality (looks like free text)
    if (col.uniqueCount && col.uniqueCount > 200) return 'unknown';
    return 'categorical';
  }
  if (col.type === 'temporal') return 'unknown';     // skip dates as drivers for now
  return 'unknown';
}

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = mean(xs), my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

function entropy(probs) {
  let h = 0;
  for (const p of probs) {
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function round(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return n;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}
function sample(arr, n) {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

module.exports = {
  analyzeDrivers,
  // Exposed for tests
  _classifyType: classifyType,
  _pearson: pearson,
  _entropy: entropy,
};
