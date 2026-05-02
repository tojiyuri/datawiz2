/**
 * sheetSpecBuilder - Converts Tableau-style sheet specs to chart data.
 *
 * Handles ALL combinations of fields on shelves:
 *   - 1 dim + 1 measure   → simple bar/line/etc.
 *   - 1 dim + N measures  → grouped bar / multi-line / stacked area (one series per measure)
 *   - 2 dims + 1 measure  → stacked/grouped by second dim, OR heatmap
 *   - 2 dims + N measures → first dim on x, first measure plotted, second dim as stack, warn extras
 *   - color shelf + dim   → adds a stack (only when no second dim already)
 *   - size shelf + measure → bubble size (scatter only)
 */
const { generateChartData } = require('./chartDataGenerator');

// Identify measures (numeric, not year/identifier/coordinate) vs dimensions
function isMeasureCol(col) {
  return col && col.type === 'numeric'
    && col.subtype !== 'year' && col.subtype !== 'identifier' && col.subtype !== 'coordinate';
}

// Stratified sample for performance on huge datasets
function sampleArray(arr, n) {
  if (!arr || arr.length <= n) return arr;
  const step = arr.length / n;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[Math.floor(i * step)];
  return out;
}
const AGG_LIMIT = 50000;

// Per-group aggregator
function compute(vals, agg) {
  if (!vals.length) return 0;
  switch (agg) {
    case 'avg': return vals.reduce((s, v) => s + v, 0) / vals.length;
    case 'count': return vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'median': { const s = [...vals].sort((a, b) => a - b); return s.length % 2 === 0 ? (s[s.length/2-1] + s[s.length/2]) / 2 : s[Math.floor(s.length/2)]; }
    default: return vals.reduce((s, v) => s + v, 0); // sum
  }
}

const round = (v, p = 2) => v == null || isNaN(v) ? v : Math.round(v * Math.pow(10, p)) / Math.pow(10, p);

// Smart sort by month/day-of-week subtype
const MONTH_ORDER = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12, jan:1, feb:2, mar:3, apr:4, jun:6, jul:7, aug:8, sep:9, sept:9, oct:10, nov:11, dec:12 };
const DAY_ORDER = { monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6, sunday:7, mon:1, tue:2, tues:2, wed:3, thu:4, thur:4, thurs:4, fri:5, sat:6, sun:7 };

function sortResult(result, xField, xCol, fallbackKey) {
  if (!result.length) return result;
  if (xCol?.subtype === 'month_name') {
    result.sort((a, b) => (MONTH_ORDER[String(a[xField]).toLowerCase()] || 99) - (MONTH_ORDER[String(b[xField]).toLowerCase()] || 99));
  } else if (xCol?.subtype === 'day_of_week') {
    result.sort((a, b) => (DAY_ORDER[String(a[xField]).toLowerCase()] || 99) - (DAY_ORDER[String(b[xField]).toLowerCase()] || 99));
  } else if (xCol?.type === 'temporal') {
    result.sort((a, b) => {
      const ad = new Date(a[xField]), bd = new Date(b[xField]);
      return !isNaN(ad) && !isNaN(bd) ? ad - bd : String(a[xField]).localeCompare(String(b[xField]));
    });
  } else if (fallbackKey) {
    result.sort((a, b) => (b[fallbackKey] || 0) - (a[fallbackKey] || 0));
  }
}

/**
 * Main entry: takes a sheet spec + dataset and returns rendered chart data.
 * Returns: { spec, chartData, stackKeys, warnings }
 */
function buildChartFromSheet(sheetSpec, ds) {
  const { applyFilters } = require('./filterEngine');
  const { applyCalculatedFields } = require('./formulaEngine');
  const { applyBins } = require('./bins');
  const { applySets } = require('./sets');
  const { applyLODs } = require('./lod');
  const { applyDrill } = require('./hierarchies');
  const { substituteParameters } = require('./parameters');
  const tableCalcs = require('./tableCalcs');
  const overlays = require('./referenceOverlays');

  // Helper: apply table calcs to chart data after it's been aggregated/shaped.
  // Skips silently if no calcs configured. The chart data shape varies (array
  // of row objects for most charts), but as long as it's an array of objects
  // we can run table calcs on it. Heatmaps and pivot grids that have a
  // different shape will be no-ops because available fields won't match.
  function applyTableCalcsToChartData(chartData, calcs, spec) {
    if (!Array.isArray(calcs) || !calcs.length) return chartData;
    if (!Array.isArray(chartData) || !chartData.length) return chartData;
    const fields = Object.keys(chartData[0] || {}).filter(k => !k.startsWith('_'));
    try {
      return tableCalcs.apply(chartData, calcs, fields);
    } catch (err) {
      warnings.push('Table calc error: ' + err.message);
      return chartData;
    }
  }

  // v6.13 helper: attach resolved reference lines/bands to a spec.
  // Resolves 'avg', 'p95', etc. into concrete numeric values using the actual
  // chart data so the renderer doesn't need to recompute them.
  function attachReferenceOverlays(spec, chartData, valueKey) {
    if (referenceLines.length) {
      spec.referenceLines = overlays.resolveReferenceLines(referenceLines, chartData, valueKey);
    }
    if (referenceBands.length) {
      spec.referenceBands = overlays.resolveReferenceBands(referenceBands, chartData, valueKey);
    }
  }

  let allColumns = ds.analysis.columns;
  let data = ds.data;
  const warnings = [];

  const {
    chartType, columns: cols = [], rows = [], color, size,
    aggregations = {}, filters = [], calculatedFields = [], crossFilter = null,
    // v6.8 advanced calc features
    bins = [], sets = [], lods = [], parameters = [], tableCalcs: tc = [],
    hierarchies = [], drill = null,
    // v6.13 visualization depth
    dualAxis = false,
    referenceLines = [],
    referenceBands = [],
    trellis = null,        // { facetBy: 'Region', max?: 12 }
  } = sheetSpec;

  // Step 0a: Substitute parameters in calculated field formulas + filter values
  let processedCalcFields = calculatedFields;
  if (parameters.length) {
    processedCalcFields = calculatedFields.map(cf => ({
      ...cf,
      formula: substituteParameters(cf.formula, parameters),
    }));
  }

  // Step 0b: LODs run FIRST — they need the raw source data before filtering,
  // because their FIXED partitions must be computed across the full dataset
  // (otherwise drill-downs would change the LOD value, which is the whole
  // point of FIXED — it stays "fixed" regardless of view).
  if (lods.length) {
    try {
      data = applyLODs(data, lods);
      const sample = data[0] || {};
      for (const lod of lods) {
        if (!allColumns.find(c => c.name === lod.name)) {
          const v = sample[lod.name];
          const isNum = typeof v === 'number' || (v != null && !isNaN(Number(v)));
          allColumns = [...allColumns, { name: lod.name, type: isNum ? 'numeric' : 'categorical', isLOD: true }];
        }
      }
    } catch (err) { warnings.push('LOD error: ' + err.message); }
  }

  // Step 1a: Apply bins (row-level — adds bucketed columns)
  if (bins.length) {
    try {
      data = applyBins(data, bins);
      for (const b of bins) {
        if (!allColumns.find(c => c.name === b.name)) {
          allColumns = [...allColumns, { name: b.name, type: 'categorical', isBin: true }];
        }
      }
    } catch (err) { warnings.push('Bin error: ' + err.message); }
  }

  // Step 1b: Apply sets (row-level — adds boolean group columns)
  if (sets.length) {
    try {
      data = applySets(data, sets);
      for (const s of sets) {
        if (!allColumns.find(c => c.name === s.name)) {
          allColumns = [...allColumns, { name: s.name, type: 'categorical', isSet: true }];
        }
      }
    } catch (err) { warnings.push('Set error: ' + err.message); }
  }

  // Step 1c: Apply calculated fields (extends each row with new computed columns)
  if (processedCalcFields.length) {
    try {
      data = applyCalculatedFields(data, processedCalcFields);
      // Synthesize column metadata for new fields so the rest of the pipeline sees them
      const sample = data[0] || {};
      for (const cf of processedCalcFields) {
        if (!allColumns.find(c => c.name === cf.name)) {
          const sampleVal = sample[cf.name];
          const isNum = typeof sampleVal === 'number' || (sampleVal != null && !isNaN(Number(sampleVal)));
          allColumns = [...allColumns, { name: cf.name, type: isNum ? 'numeric' : 'categorical', isCalculated: true, formula: cf.formula }];
        }
      }
    } catch (err) { warnings.push('Calculated fields error: ' + err.message); }
  }

  // Step 2a: Apply hierarchy drill (filter to drilled-into values)
  if (drill && drill.hierarchyName && hierarchies.length) {
    const hier = hierarchies.find(h => h.name === drill.hierarchyName);
    if (hier) {
      try { data = applyDrill(data, hier, drill); }
      catch (err) { warnings.push('Drill error: ' + err.message); }
    }
  }

  // Step 2b: Apply filters (including cross-filter from dashboard interactions)
  const allFilters = [...filters];
  if (crossFilter && crossFilter.field && crossFilter.value !== undefined) {
    allFilters.push({ field: crossFilter.field, op: '=', value: crossFilter.value });
  }
  const filteredData = applyFilters(data, allFilters);

  // Sample if huge
  const workData = filteredData.length > AGG_LIMIT ? sampleArray(filteredData, AGG_LIMIT) : filteredData;

  // Categorize each shelf field
  const colsAsDims = cols.filter(c => !isMeasureCol(allColumns.find(ac => ac.name === c.name)));
  const colsAsMeasures = cols.filter(c => isMeasureCol(allColumns.find(ac => ac.name === c.name)));
  const rowsAsMeasures = rows.filter(r => isMeasureCol(allColumns.find(ac => ac.name === r.name)));
  const rowsAsDims = rows.filter(r => !isMeasureCol(allColumns.find(ac => ac.name === r.name)));

  // Pick the dimensions for x-axis and (optional) stacking
  const allDims = [...colsAsDims, ...rowsAsDims];
  // Pick measures for plotting
  const allMeasures = [...rowsAsMeasures, ...colsAsMeasures];

  const dimX = allDims[0]?.name;
  const dim2 = allDims[1]?.name;
  // Color shelf only adds a stack if we don't already have a second dim
  const stackField = dim2 || color?.name;

  // ─── EMPTY STATE ───
  if (!dimX && !allMeasures.length) {
    return { spec: { type: chartType, title: 'Add fields to shelves' }, chartData: [], stackKeys: null, warnings };
  }

  // ─── TRELLIS / SMALL MULTIPLES ────────────────────────────────────────────
  // When trellis.facetBy is set, split the data by that field and produce one
  // mini-chart per distinct value. Returns a 'trellis' spec containing an
  // array of facet specs that the renderer lays out in a grid.
  if (trellis?.facetBy && chartType !== 'heatmap' && chartType !== 'sankey' && chartType !== 'map') {
    const facetCol = allColumns.find(c => c.name === trellis.facetBy);
    if (!facetCol) {
      warnings.push(`Trellis facet column '${trellis.facetBy}' not found`);
    } else {
      const maxFacets = trellis.max ?? 12;
      // Group data by facet value
      const groups = new Map();
      for (const r of workData) {
        const key = r[trellis.facetBy];
        if (key == null || key === '') continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      // Sort facets by row count (most data first) and cap
      const facetEntries = Array.from(groups.entries())
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, maxFacets);

      // Build a sub-spec for each facet by recursively calling buildChart
      // with the facet value pinned as a filter and trellis disabled.
      const facets = [];
      for (const [facetValue, facetData] of facetEntries) {
        const subSpec = {
          ...sheetSpec,
          trellis: null,                                  // prevent infinite recursion
          filters: [...(sheetSpec.filters || []),
            { field: trellis.facetBy, op: '=', value: facetValue }],
        };
        try {
          const sub = buildChartFromSheet(subSpec, ds);
          facets.push({
            facetValue: String(facetValue),
            spec: sub.spec,
            chartData: sub.chartData,
            stackKeys: sub.stackKeys,
          });
        } catch (err) {
          // Skip broken facets rather than failing the whole trellis
          console.warn(`[trellis] Skipping facet '${facetValue}': ${err.message}`);
        }
      }

      // Compute shared y-domain so facets compare honestly
      // (Without this, each tiny chart has its own scale and visual comparison
      // becomes meaningless.)
      let sharedYDomain = null;
      const valueKey = facets[0]?.spec?.y;
      if (valueKey) {
        const allYs = facets.flatMap(f =>
          (Array.isArray(f.chartData) ? f.chartData : [])
            .map(r => Number(r[valueKey])).filter(v => Number.isFinite(v))
        );
        if (allYs.length) {
          sharedYDomain = [Math.min(0, ...allYs), Math.max(...allYs)];
        }
      }

      const trellisSpec = {
        type: 'trellis',
        facetBy: trellis.facetBy,
        baseChartType: chartType,
        facets,
        facetCount: facetEntries.length,
        sharedYDomain,
        truncated: groups.size > maxFacets,
        title: `${chartType} faceted by ${trellis.facetBy}`,
      };
      return { spec: trellisSpec, chartData: facets, stackKeys: null, warnings };
    }
  }

  // ─── HEATMAP: special case — needs 2 dims + 1 measure ───
  if (chartType === 'heatmap' && allDims.length >= 2 && allMeasures.length >= 1) {
    const m = allMeasures[0];
    const spec = { type: 'heatmap', x: allDims[0].name, y: allDims[1].name, value: m.name, title: `${m.name} by ${allDims[0].name} × ${allDims[1].name}` };
    const chartDataRaw = generateChartData(spec, workData, allColumns);
    const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
    if (allMeasures.length > 1) warnings.push('Heatmap uses only the first measure');
    if (allDims.length > 2) warnings.push('Heatmap uses only the first two dimensions');
    return { spec, chartData, stackKeys: null, warnings };
  }

  // ─── PIE/DONUT/TREEMAP/FUNNEL/GAUGE: 1 dim + 1 measure ───
  if (['pie', 'donut', 'treemap', 'funnel', 'gauge'].includes(chartType)) {
    const m = allMeasures[0];
    const spec = { type: chartType, x: dimX, y: m?.name, category: dimX, value: m?.name, title: `${m?.name || 'count'} by ${dimX}` };
    const chartDataRaw = generateChartData(spec, workData, allColumns);
    const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
    if (allMeasures.length > 1) warnings.push(`${chartType} uses only the first measure (${m?.name})`);
    if (allDims.length > 1) warnings.push(`${chartType} uses only one dimension`);
    return { spec, chartData, stackKeys: null, warnings };
  }

  // ─── SCATTER/BUBBLE: needs 2 measures ───
  if (chartType === 'scatter' || chartType === 'bubble') {
    if (allMeasures.length < 2) {
      warnings.push('Scatter needs at least 2 measures — drop another numeric field on Rows');
      return { spec: { type: chartType, title: 'Need 2 measures' }, chartData: [], stackKeys: null, warnings };
    }
    const spec = { type: chartType, x: allMeasures[0].name, y: allMeasures[1].name, title: `${allMeasures[1].name} vs ${allMeasures[0].name}` };
    if (size) spec.size = size.name;
    if (chartType === 'bubble' && !size && allMeasures[2]) spec.size = allMeasures[2].name;
    const chartDataRaw = generateChartData(spec, workData, allColumns);
    const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
    return { spec, chartData, stackKeys: null, warnings };
  }

  // ─── HISTOGRAM: 1 measure on Rows ───
  if (chartType === 'histogram') {
    const m = allMeasures[0];
    if (!m) {
      warnings.push('Histogram needs a numeric measure');
      return { spec: { type: 'histogram', title: 'Add a measure' }, chartData: [], stackKeys: null, warnings };
    }
    const spec = { type: 'histogram', x: m.name, title: `Distribution of ${m.name}` };
    const chartDataRaw = generateChartData(spec, workData, allColumns);
    const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
    return { spec, chartData, stackKeys: null, warnings };
  }

  // ─── FORECAST: needs temporal x + 1 measure ───
  if (chartType === 'forecast') {
    const m = allMeasures[0];
    if (!m || !dimX) {
      warnings.push('Forecast needs a date dimension and a measure');
      return { spec: { type: 'forecast', title: 'Add date + measure' }, chartData: [], stackKeys: null, warnings };
    }
    const spec = { type: 'forecast', x: dimX, y: m.name, title: `${m.name} Forecast` };
    const chartDataRaw = generateChartData(spec, workData, allColumns);
    const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
    return { spec, chartData, stackKeys: null, warnings };
  }

  // ─── BAR / LINE / AREA / HORIZONTAL_BAR: handle multi-measure + multi-dim ───
  if (!dimX) {
    warnings.push('Drop a dimension on Columns');
    return { spec: { type: chartType, title: 'Add dimension' }, chartData: [], stackKeys: null, warnings };
  }
  if (!allMeasures.length) {
    warnings.push('Drop a measure on Rows');
    return { spec: { type: chartType, title: 'Add measure' }, chartData: [], stackKeys: null, warnings };
  }

  const xCol = allColumns.find(c => c.name === dimX);

  // CASE A: Multi-measure (N>=2 measures) → grouped/stacked by measure
  // When user drops 3 measures + 2 dims, the multi-measure view is more meaningful
  // than picking just the first measure. Warn that extra dim is ignored.
  if (allMeasures.length >= 2) {
    const measureNames = allMeasures.map(m => m.name);
    if (dim2) warnings.push(`Second dimension '${dim2}' ignored — using ${measureNames.length} measures as series instead`);
    if (color && !dim2) warnings.push(`Color field '${color.name}' ignored — using measures as series instead`);
    // Aggregate per (x, measure)
    const groups = {};
    workData.forEach(r => {
      const xVal = String(r[dimX] ?? 'Unknown');
      if (!groups[xVal]) {
        groups[xVal] = {};
        measureNames.forEach(mn => { groups[xVal][mn] = []; });
      }
      measureNames.forEach(mn => {
        const v = Number(r[mn]);
        if (!isNaN(v)) groups[xVal][mn].push(v);
      });
    });
    let result = Object.entries(groups).map(([x, perM]) => {
      const row = { [dimX]: x };
      measureNames.forEach((mn, i) => {
        const agg = aggregations[mn] || allMeasures[i].aggregation || 'sum';
        row[mn] = round(compute(perM[mn] || [], agg));
      });
      return row;
    });
    sortResult(result, dimX, xCol, measureNames[0]);
    result = result.slice(0, 50);
    result._stackKeys = measureNames;

    // Map base chart type to multi-series variant
    let mappedType = chartType;
    if (chartType === 'bar' || chartType === 'horizontal_bar') mappedType = 'grouped_bar_multi';
    else if (chartType === 'line') mappedType = 'multi_line';
    else if (chartType === 'area') mappedType = 'stacked_area';

    // v6.13 — Dual axis: when user explicitly opted in AND there are exactly
    // 2 measures, route to a dual_axis chart with the second measure on the
    // right Y axis. Useful when measures are on different scales (revenue
    // vs. % margin, count vs. avg, etc.). Skip for area/horizontal_bar where
    // dual axis doesn't make visual sense.
    if (dualAxis && measureNames.length === 2 &&
        (chartType === 'bar' || chartType === 'line' || chartType === 'combo')) {
      const spec = {
        type: 'dual_axis',
        x: dimX,
        y: measureNames[0],         // primary, left axis
        y2: measureNames[1],        // secondary, right axis
        leftKind: chartType === 'line' ? 'line' : 'bar',
        rightKind: chartType === 'line' ? 'line' : 'line',
        title: `${measureNames[0]} (left) + ${measureNames[1]} (right) by ${dimX}`,
      };
      attachReferenceOverlays(spec, result, measureNames[0]);
      return { spec, chartData: applyTableCalcsToChartData(result, tc, spec), stackKeys: null, warnings };
    }

    const spec = {
      type: mappedType,
      x: dimX, y: measureNames[0],
      _multipleY: measureNames,
      title: `${measureNames.join(' + ')} by ${dimX}`,
      aggregation: aggregations[measureNames[0]] || 'sum',
    };
    attachReferenceOverlays(spec, result, measureNames[0]);
    return { spec, chartData: applyTableCalcsToChartData(result, tc, spec), stackKeys: measureNames, warnings };
  }

  // CASE B: 1 measure + 2 dimensions (or color shelf) → stacked
  if (allMeasures.length === 1 && stackField) {
    const m = allMeasures[0];
    const agg = aggregations[m.name] || m.aggregation || 'sum';
    let stackedType = chartType;
    if (chartType === 'bar' || chartType === 'horizontal_bar') stackedType = 'stacked_bar';
    else if (chartType === 'area') stackedType = 'stacked_area';
    else if (chartType === 'line') stackedType = 'multi_line';
    const spec = { type: stackedType, x: dimX, y: m.name, stack: stackField, aggregation: agg, title: `${m.name} by ${dimX} (split by ${stackField})` };
    const chartDataRaw = generateChartData(spec, workData, allColumns);
    const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
    attachReferenceOverlays(spec, chartData, m.name);
    return { spec, chartData, stackKeys: chartData?._stackKeys, warnings };
  }

  // CASE C: 1 measure + 1 dim (simple)
  const m = allMeasures[0];
  const agg = aggregations[m.name] || m.aggregation || 'sum';
  const spec = { type: chartType, x: dimX, y: m.name, aggregation: agg, title: `${m.name} by ${dimX}` };
  const chartDataRaw = generateChartData(spec, workData, allColumns);
  const chartData = applyTableCalcsToChartData(chartDataRaw, tc, spec);
  attachReferenceOverlays(spec, chartData, m.name);
  return { spec, chartData, stackKeys: chartData?._stackKeys, warnings };
}

module.exports = { buildChartFromSheet };
