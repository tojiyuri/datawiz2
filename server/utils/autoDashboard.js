/**
 * autoDashboard — given a dataset's analysis, picks 4-6 charts that together
 * tell the story of the data. The output is an array of sheet specs ready
 * to render via sheetSpecBuilder.
 *
 * The selection is heuristic, not random: we pick charts that cover different
 * angles of the data (KPIs, breakdowns, time trends, distributions, top/bottom)
 * so users get a survey, not 6 variations of the same view.
 *
 * Order of operations:
 *   1. Classify columns: identifiers, dates, numerics, categoricals
 *   2. Pick a primary measure (highest-magnitude numeric, ideally money-shaped)
 *   3. Pick a primary dimension (mid-cardinality categorical, ideally <30 unique)
 *   4. Generate canonical charts:
 *      - KPI tiles (sum/avg of primary measure)
 *      - Time trend (if a date column exists)
 *      - Bar of measure-by-primary-dim
 *      - Top-10 by primary-dim ranked by measure
 *      - Distribution histogram of primary measure
 *      - Heatmap or scatter (if 2+ numerics or 2+ dims)
 *   5. Drop charts that don't make sense for this dataset
 *
 * The output is a list of { name, spec } pairs. Each becomes a sheet, then
 * tiles get arranged into a dashboard.
 */

// Common money-suggesting words — we boost numeric columns with these names
const MEASURE_KEYWORDS = ['revenue','sales','income','profit','amount','total','cost','price','spend','value'];
// Common identifier words — we de-prioritize these as dimensions
const ID_KEYWORDS = ['id','uuid','guid','code','number','sku'];

function classify(columns) {
  const out = { numerics: [], categoricals: [], dates: [], identifiers: [] };
  for (const c of columns) {
    const lower = (c.name || '').toLowerCase();
    const isIdLike = ID_KEYWORDS.some(k => lower.endsWith(k) || lower === k);
    if (c.type === 'temporal' || c.subtype === 'date' || c.subtype === 'datetime') {
      out.dates.push(c);
    } else if (c.type === 'numeric') {
      if (c.subtype === 'identifier' || c.subtype === 'coordinate' || isIdLike) {
        out.identifiers.push(c);
      } else {
        out.numerics.push(c);
      }
    } else if (c.type === 'categorical') {
      out.categoricals.push(c);
    }
  }
  return out;
}

/**
 * Pick the column most likely to be the "primary measure" — what the user
 * cares most about. Heuristic: weight by name keyword (revenue/sales = +3),
 * by magnitude (larger range = more interesting), by uniqueness (lower = bad).
 */
function pickPrimaryMeasure(numerics) {
  if (!numerics.length) return null;
  const scored = numerics.map(c => {
    const lower = (c.name || '').toLowerCase();
    const keywordHit = MEASURE_KEYWORDS.find(k => lower.includes(k)) ? 3 : 0;
    const range = c.stats?.range || 0;
    // Prefer numerics with reasonable spread (range > 0) and that aren't all integers (likely counts)
    const spreadScore = Math.log10(Math.abs(range) + 1);
    return { col: c, score: keywordHit + spreadScore };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].col;
}

/**
 * Pick the column most likely to be the "primary dimension" — the most
 * useful breakdown. Heuristic: prefer cardinalities between 3 and 30.
 * Below 3 = boring (only a couple of slices), above 30 = noisy.
 */
function pickPrimaryDimension(categoricals) {
  if (!categoricals.length) return null;
  const scored = categoricals.map(c => {
    const u = c.uniqueCount || 0;
    let score = 0;
    if (u >= 3 && u <= 12) score = 5;          // ideal
    else if (u >= 3 && u <= 30) score = 3;     // good
    else if (u > 30 && u <= 100) score = 1;    // OK
    else if (u < 3) score = -2;                 // too few
    else score = -3;                            // too many
    // Prefer columns that look like classifications (Region, Category, Type, ...)
    const lower = (c.name || '').toLowerCase();
    if (['region','category','type','class','group','department','segment','tier'].some(k => lower.includes(k))) {
      score += 2;
    }
    return { col: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score > -2 ? scored[0].col : null;
}

/**
 * Build a chart spec for a sheet. Each spec follows the format that
 * sheetSpecBuilder expects: chartType, columns shelf, rows shelf, color, etc.
 */

function kpiSpec(measure, agg = 'sum') {
  return {
    name: `${capitalize(agg)} of ${measure.name}`,
    spec: {
      chartType: 'kpi',
      columns: [],
      rows: [{ name: measure.name, type: 'numeric', aggregation: agg }],
    },
    layout: { w: 1, h: 1 },  // small tile
    insightFocus: 'kpi',
  };
}

function timeTrendSpec(date, measure) {
  return {
    name: `${measure.name} over time`,
    spec: {
      chartType: 'line',
      columns: [{ name: date.name, type: 'date' }],
      rows: [{ name: measure.name, type: 'numeric', aggregation: 'sum' }],
    },
    layout: { w: 2, h: 1 },
    insightFocus: 'trend',
  };
}

function barByDimSpec(dim, measure) {
  return {
    name: `${measure.name} by ${dim.name}`,
    spec: {
      chartType: 'bar',
      columns: [{ name: dim.name, type: 'categorical' }],
      rows: [{ name: measure.name, type: 'numeric', aggregation: 'sum' }],
    },
    layout: { w: 2, h: 1 },
    insightFocus: 'distribution',
  };
}

function topNSpec(dim, measure, n = 10) {
  return {
    name: `Top ${n} ${dim.name} by ${measure.name}`,
    spec: {
      chartType: 'bar',
      columns: [{ name: dim.name, type: 'categorical' }],
      rows: [{ name: measure.name, type: 'numeric', aggregation: 'sum' }],
      filters: [{ field: dim.name, op: 'top_n', value: n, by: measure.name }],
    },
    layout: { w: 2, h: 1 },
    insightFocus: 'concentration',
  };
}

function histogramSpec(measure) {
  return {
    name: `Distribution of ${measure.name}`,
    spec: {
      chartType: 'histogram',
      columns: [],
      rows: [{ name: measure.name, type: 'numeric', aggregation: 'sum' }],
    },
    layout: { w: 2, h: 1 },
    insightFocus: 'spread',
  };
}

function scatterSpec(numA, numB) {
  return {
    name: `${numA.name} vs ${numB.name}`,
    spec: {
      chartType: 'scatter',
      columns: [{ name: numA.name, type: 'numeric', aggregation: 'sum' }],
      rows: [{ name: numB.name, type: 'numeric', aggregation: 'sum' }],
    },
    layout: { w: 2, h: 1 },
    insightFocus: 'correlation',
  };
}

function pieSpec(dim, measure) {
  return {
    name: `${measure.name} share by ${dim.name}`,
    spec: {
      chartType: 'pie',
      columns: [{ name: dim.name, type: 'categorical' }],
      rows: [{ name: measure.name, type: 'numeric', aggregation: 'sum' }],
    },
    layout: { w: 1, h: 1 },
    insightFocus: 'share',
  };
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

/**
 * Main entry. Returns an ordered array of chart blueprints; the caller will
 * turn each into a saved sheet, then arrange them into dashboard tiles.
 */
function generate({ analysis }) {
  if (!analysis?.columns?.length) return [];

  const cols = classify(analysis.columns);
  const primaryMeasure = pickPrimaryMeasure(cols.numerics);
  const primaryDim = pickPrimaryDimension(cols.categoricals);
  const primaryDate = cols.dates[0] || null;

  const blueprints = [];

  // KPI tiles — only meaningful if we have a measure
  if (primaryMeasure) {
    blueprints.push(kpiSpec(primaryMeasure, 'sum'));
    blueprints.push(kpiSpec(primaryMeasure, 'avg'));
  }

  // Time trend (highest value if data has a temporal column)
  if (primaryDate && primaryMeasure) {
    blueprints.push(timeTrendSpec(primaryDate, primaryMeasure));
  }

  // Breakdown by primary dim
  if (primaryDim && primaryMeasure) {
    blueprints.push(barByDimSpec(primaryDim, primaryMeasure));
  }

  // Top-N — only when cardinality is high enough that a top-N is more useful
  // than the full breakdown bar above.
  if (primaryDim && primaryMeasure && (primaryDim.uniqueCount || 0) > 12) {
    blueprints.push(topNSpec(primaryDim, primaryMeasure, 10));
  }

  // Pie/share chart — only when low cardinality (otherwise pie is unreadable)
  if (primaryDim && primaryMeasure && (primaryDim.uniqueCount || 0) <= 8) {
    blueprints.push(pieSpec(primaryDim, primaryMeasure));
  }

  // Distribution histogram of the primary measure
  if (primaryMeasure) {
    blueprints.push(histogramSpec(primaryMeasure));
  }

  // Scatter if there's a meaningful second numeric
  if (cols.numerics.length >= 2 && primaryMeasure) {
    const second = cols.numerics.find(c => c.name !== primaryMeasure.name);
    if (second) blueprints.push(scatterSpec(primaryMeasure, second));
  }

  // Cap at 6 tiles — more becomes overwhelming. Keep the first 6 in priority order.
  return blueprints.slice(0, 6);
}

module.exports = { generate, classify, pickPrimaryMeasure, pickPrimaryDimension };
