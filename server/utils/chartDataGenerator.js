/**
 * ChartDataGenerator v3 - All chart types including geographic, text, image, forecast.
 */
const round = (v, p = 2) => v == null || isNaN(v) ? v : Math.round(v * Math.pow(10, p)) / Math.pow(10, p);
const { forecastTimeSeries } = require('./insightEngine');

// Stratified sample preserving order — used to keep large datasets fast
function sampleArray(arr, n) {
  if (!arr || arr.length <= n) return arr;
  const step = arr.length / n;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = arr[Math.floor(i * step)];
  return out;
}

// Threshold above which we sample for aggregation (preserves group counts well)
const AGG_SAMPLE_LIMIT = 50000;

// Order maps for temporal subtypes (so January, February, ... not April, August, December)
const MONTH_ORDER = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DAY_ORDER = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sunday: 7, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6, sun: 7 };

function sortByTemporalSubtype(arr, key, subtype) {
  if (subtype === 'month_name') {
    arr.sort((a, b) => (MONTH_ORDER[String(a[key]).toLowerCase()] || 99) - (MONTH_ORDER[String(b[key]).toLowerCase()] || 99));
    return true;
  }
  if (subtype === 'day_of_week') {
    arr.sort((a, b) => (DAY_ORDER[String(a[key]).toLowerCase()] || 99) - (DAY_ORDER[String(b[key]).toLowerCase()] || 99));
    return true;
  }
  if (subtype === 'year' || subtype === 'month_num') {
    arr.sort((a, b) => Number(a[key]) - Number(b[key]));
    return true;
  }
  return false;
}

function generateChartData(spec, data, columns) {
  const { type, x, y, y2, aggregation = 'sum', category, value, stack, size, metrics } = spec;

  // ─── PIE / DONUT / TREEMAP / FUNNEL / SUNBURST ───
  if (['pie', 'donut', 'treemap', 'funnel', 'gauge'].includes(type)) {
    const cat = category || x, val = value || y;
    const agg = {};
    data.forEach(r => { const k = String(r[cat] ?? 'Unknown'); agg[k] = (agg[k] || 0) + (Number(r[val]) || 0); });
    return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, v]) => ({ name, value: round(v) }));
  }

  // ─── SUNBURST (hierarchical) ───
  if (type === 'sunburst') {
    if (!stack && !spec.group2) {
      // Fallback: just use single category
      return generateChartData({ ...spec, type: 'donut' }, data, columns);
    }
    // Build hierarchy: [cat] -> [stack] -> sum(value)
    const hier = {};
    data.forEach(r => {
      const a = String(r[x] ?? 'Unknown');
      const b = String(r[stack] ?? 'Other');
      if (!hier[a]) hier[a] = {};
      hier[a][b] = (hier[a][b] || 0) + (Number(r[y]) || 0);
    });
    const result = [];
    Object.entries(hier).forEach(([parent, children]) => {
      Object.entries(children).forEach(([child, val]) => {
        result.push({ parent, child, value: round(val), name: `${parent} / ${child}` });
      });
    });
    return result;
  }

  // ─── SCATTER / BUBBLE ───
  if (type === 'scatter' || type === 'bubble') {
    // Sample large datasets before processing — random sampling preserves distribution
    const source = data.length > 5000 ? sampleArray(data, 1000) : data;
    return source.map(r => {
      const pt = { [x]: Number(r[x]), [y]: Number(r[y]) };
      if (size) pt[size] = Math.abs(Number(r[size])) || 1;
      return pt;
    }).filter(r => !isNaN(r[x]) && !isNaN(r[y])).slice(0, 1000);
  }

  // ─── HISTOGRAM ───
  if (type === 'histogram') {
    const col = columns.find(c => c.name === x);
    // Numeric histogram
    if (col?.type === 'numeric') return col?.stats?.histogram || [];
    // Text length histogram
    if (col?.type === 'text') return col?.stats?.lengthHistogram || [];
    return [];
  }

  // ─── WORD CLOUD ───
  if (type === 'word_cloud') {
    const col = columns.find(c => c.name === x);
    return col?.stats?.topWords || [];
  }

  // ─── IMAGE GALLERY ───
  if (type === 'image_gallery') {
    const col = columns.find(c => c.name === x);
    if (!col) return [];
    return data.slice(0, 24).map(r => ({
      url: String(r[x] ?? ''),
      label: spec.label ? String(r[spec.label] ?? '') : '',
      value: spec.value ? Number(r[spec.value]) || 0 : null,
    })).filter(it => it.url);
  }

  // ─── RADAR ───
  if (type === 'radar') {
    const m = metrics || columns.filter(c => c.type === 'numeric').slice(0, 6).map(c => c.name);
    const means = m.map(name => {
      const vals = data.map(r => Number(r[name])).filter(n => !isNaN(n));
      return { metric: name, value: vals.length ? round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0 };
    });
    const maxV = Math.max(...means.map(m => Math.abs(m.value)), 1);
    return means.map(m => ({ ...m, normalized: Math.round((m.value / maxV) * 100) }));
  }

  // ─── BOX PLOT ───
  if (type === 'box_plot') {
    const source = data.length > AGG_SAMPLE_LIMIT ? sampleArray(data, AGG_SAMPLE_LIMIT) : data;
    // Single pass: group by x, collect numeric y values
    const groups = {};
    source.forEach(r => {
      const cat = String(r[x] ?? 'Unknown');
      const v = Number(r[y]);
      if (isNaN(v)) return;
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(v);
    });
    return Object.entries(groups).slice(0, 10).map(([cat, vals]) => {
      vals.sort((a, b) => a - b);
      if (!vals.length) return { category: cat, min: 0, q1: 0, median: 0, q3: 0, max: 0 };
      return { category: cat, min: round(vals[0]), q1: round(vals[Math.floor(vals.length * 0.25)]), median: round(vals[Math.floor(vals.length * 0.5)]), q3: round(vals[Math.floor(vals.length * 0.75)]), max: round(vals[vals.length - 1]) };
    });
  }

  // ─── HEATMAP ───
  if (type === 'heatmap') {
    const source = data.length > AGG_SAMPLE_LIMIT ? sampleArray(data, AGG_SAMPLE_LIMIT) : data;
    const val = value || columns.find(c => c.type === 'numeric')?.name;
    // Single pass: build cell sums keyed by "x|y"
    const cells = {};
    const xCounts = {}, yCounts = {};
    source.forEach(r => {
      const xv = String(r[x]), yv = String(r[y]);
      xCounts[xv] = (xCounts[xv] || 0) + 1;
      yCounts[yv] = (yCounts[yv] || 0) + 1;
      const key = xv + '|' + yv;
      cells[key] = (cells[key] || 0) + (val ? (Number(r[val]) || 0) : 1);
    });
    // Pick top 12 most-frequent x and y values
    const xVals = Object.entries(xCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => e[0]);
    const yVals = Object.entries(yCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => e[0]);
    const result = [];
    for (const xv of xVals) for (const yv of yVals) {
      const sum = cells[xv + '|' + yv] || 0;
      result.push({ x: xv, y: yv, value: round(sum) });
    }
    return result;
  }

  // ─── MAP (geographic choropleth) ───
  if (type === 'map') {
    const cat = category || x, val = value || y;
    const agg = {};
    data.forEach(r => {
      const k = String(r[cat] ?? '').trim();
      if (!k) return;
      agg[k] = (agg[k] || 0) + (Number(r[val]) || 0);
    });
    return Object.entries(agg).map(([region, value]) => ({
      region, value: round(value),
      regionKey: region.toLowerCase(),
    })).sort((a, b) => b.value - a.value);
  }

  // ─── SANKEY (flow between two categorical stages) ───
  if (type === 'sankey') {
    const sourceCol = x, targetCol = stack || y;
    const valCol = value || columns.find(c => c.type === 'numeric')?.name;
    const flows = {};
    data.forEach(r => {
      const s = String(r[sourceCol] ?? 'Unknown');
      const t = String(r[targetCol] ?? 'Unknown');
      const k = `${s}||${t}`;
      flows[k] = (flows[k] || 0) + (valCol ? (Number(r[valCol]) || 0) : 1);
    });
    const links = Object.entries(flows).map(([k, v]) => {
      const [source, target] = k.split('||');
      return { source: `s:${source}`, target: `t:${target}`, value: round(v) };
    }).filter(l => l.value > 0).sort((a, b) => b.value - a.value).slice(0, 30);
    const nodeNames = new Set();
    links.forEach(l => { nodeNames.add(l.source); nodeNames.add(l.target); });
    return { nodes: [...nodeNames].map(name => ({ name: name.replace(/^[st]:/, '') })), links };
  }

  // ─── WATERFALL ───
  if (type === 'waterfall') {
    const agg = {};
    data.forEach(r => { const k = String(r[x] ?? 'Unknown'); agg[k] = (agg[k] || 0) + (Number(r[y]) || 0); });
    let running = 0;
    const result = Object.entries(agg).slice(0, 15).map(([name, val]) => {
      const item = { name, value: round(val), start: round(running) };
      running += val;
      item.end = round(running);
      return item;
    });
    result.push({ name: 'Total', value: round(running), start: 0, end: round(running), isTotal: true });
    return result;
  }

  // ─── FORECAST (extends a line chart with predictions + confidence band) ───
  if (type === 'forecast') {
    const fcEngine = require('./forecastEngine');
    const fcSource = data.length > AGG_SAMPLE_LIMIT ? sampleArray(data, AGG_SAMPLE_LIMIT) : data;
    const sorted = [...fcSource].sort((a, b) => {
      const ad = new Date(a[x]), bd = new Date(b[x]);
      return !isNaN(ad) && !isNaN(bd) ? ad - bd : String(a[x]).localeCompare(String(b[x]));
    });
    const xCol = columns.find(c => c.name === x);
    // Aggregate by x
    const agg = {};
    sorted.forEach(r => {
      const k = String(r[x] ?? 'Unknown');
      if (!agg[k]) agg[k] = { [x]: k, _sum: 0, _count: 0 };
      const v = Number(r[y]) || 0;
      agg[k]._sum += v; agg[k]._count++;
    });
    const series = Object.values(agg).map(e => ({ [x]: e[x], [y]: round(e._sum) }));
    // Generate forecast using v6.14 Holt-Winters engine. Falls back to
    // simple/holt automatically based on series length and seasonality.
    const yvals = series.map(s => s[y]);
    const horizon = spec.forecastHorizon || 5;
    const fc = fcEngine.forecast(yvals, horizon, {
      method: spec.forecastMethod || 'auto',
      season: spec.forecastSeason,
    });
    const out = series.map(s => ({ ...s, isHistory: true }));
    if (fc) {
      const lastDate = sorted[sorted.length - 1]?.[x];
      fc.forecast.forEach((p, i) => {
        const nextX = incrementDate(lastDate, i + 1, xCol?.type === 'temporal');
        out.push({
          [x]: nextX,
          [y]: p.value,
          forecast: p.value,
          lower: p.lower,
          upper: p.upper,
          isHistory: false,
        });
      });
      // Attach model info to the spec for the renderer to display
      out._forecastModel = { method: fc.method, ...fc.model };
    }
    return out;
  }

  // ─── STACKED variants ───
  if (stack) {
    const stackedSource = data.length > AGG_SAMPLE_LIMIT ? sampleArray(data, AGG_SAMPLE_LIMIT) : data;
    const agg = {};
    const xCounts = {}, sCounts = {};
    stackedSource.forEach(r => {
      const k = String(r[x] ?? 'Unknown'), sk = String(r[stack] ?? 'Other');
      xCounts[k] = (xCounts[k] || 0) + 1;
      sCounts[sk] = (sCounts[sk] || 0) + 1;
      const key = k + '||' + sk;
      agg[key] = (agg[key] || 0) + (Number(r[y]) || 0);
    });
    let xKeys = Object.keys(xCounts);
    const xCol = columns.find(c => c.name === x);
    // Try temporal subtype sort
    if (xCol?.subtype && (xCol.subtype === 'month_name' || xCol.subtype === 'day_of_week' || xCol.subtype === 'year' || xCol.subtype === 'month_num')) {
      const wrapped = xKeys.map(k => ({ [x]: k }));
      sortByTemporalSubtype(wrapped, x, xCol.subtype);
      xKeys = wrapped.map(w => w[x]);
    } else if (xCol?.type === 'temporal') {
      xKeys.sort((a, b) => { const ad = new Date(a), bd = new Date(b); return !isNaN(ad) && !isNaN(bd) ? ad - bd : a.localeCompare(b); });
    } else {
      xKeys.sort((a, b) => xCounts[b] - xCounts[a]);
    }
    xKeys = xKeys.slice(0, 30);
    const stackKeys = Object.entries(sCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(e => e[0]);
    // Direct dict lookup instead of Object.values(agg).find()
    const result = xKeys.map(xk => {
      const row = { [x]: xk };
      for (const sk of stackKeys) row[sk] = round(agg[xk + '||' + sk] || 0);
      return row;
    });
    result._stackKeys = stackKeys;
    return result;
  }

  // ─── BAR / LINE / AREA / GROUPED / COMBO ───
  const source = data.length > AGG_SAMPLE_LIMIT ? sampleArray(data, AGG_SAMPLE_LIMIT) : data;
  const agg = {};
  let idx = 0;
  source.forEach(r => {
    const k = x === 'index' ? String(idx++) : String(r[x] ?? 'Unknown');
    if (!agg[k]) agg[k] = { [x]: k, _sum: 0, _sum2: 0, _count: 0, _vals: [], _vals2: [] };
    const v = Number(r[y]) || 0;
    agg[k]._sum += v; agg[k]._count++; agg[k]._vals.push(v);
    if (y2) { agg[k]._sum2 += Number(r[y2]) || 0; agg[k]._vals2.push(Number(r[y2]) || 0); }
  });
  let result = Object.values(agg).map(e => {
    const compute = (vals, sum) => {
      switch (aggregation) {
        case 'avg': return e._count ? sum / e._count : 0;
        case 'count': return e._count;
        case 'max': return vals.length ? Math.max(...vals) : 0;
        case 'min': return vals.length ? Math.min(...vals) : 0;
        case 'median': { const s = [...vals].sort((a,b)=>a-b); return s.length ? s.length%2===0 ? (s[s.length/2-1]+s[s.length/2])/2 : s[Math.floor(s.length/2)] : 0; }
        default: return sum;
      }
    };
    const row = { [x]: e[x], [y]: round(compute(e._vals, e._sum)) };
    if (y2) row[y2] = round(compute(e._vals2, e._sum2));
    return row;
  });
  const xCol = columns.find(c => c.name === x);
  // Try temporal subtype sort first (month_name, day_of_week, year)
  const sortedBySubtype = sortByTemporalSubtype(result, x, xCol?.subtype);
  if (!sortedBySubtype && xCol?.type === 'temporal') {
    result.sort((a, b) => { const ad = new Date(a[x]), bd = new Date(b[x]); return !isNaN(ad) && !isNaN(bd) ? ad - bd : String(a[x]).localeCompare(String(b[x])); });
  } else if (!sortedBySubtype && ['bar', 'horizontal_bar'].includes(type)) {
    result.sort((a, b) => (b[y] || 0) - (a[y] || 0));
  }
  return result.slice(0, 50);
}

// Best-effort date incrementer
function incrementDate(lastVal, steps, isTemporal) {
  if (!isTemporal) return `t+${steps}`;
  const d = new Date(lastVal);
  if (isNaN(d.getTime())) return `t+${steps}`;
  d.setDate(d.getDate() + steps);
  return d.toISOString().split('T')[0];
}

module.exports = { generateChartData };
