/**
 * InsightEngine v2 - Expert data scientist analysis.
 *
 * Generates predictions and recommendations as if a senior analyst is reviewing
 * the data. Output drives the dashboard's "Executive Recommendations" panel
 * and per-chart insight pills.
 */

const round = (v, p = 2) => v == null || isNaN(v) ? v : Math.round(v * Math.pow(10, p)) / Math.pow(10, p);

// ─── LINEAR REGRESSION ───
function linearRegression(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const sumX = xs.reduce((s, v) => s + v, 0);
  const sumY = ys.reduce((s, v) => s + v, 0);
  const sumXY = xs.reduce((s, v, i) => s + v * ys[i], 0);
  const sumX2 = xs.reduce((s, v) => s + v * v, 0);
  const denX = (n * sumX2 - sumX * sumX);
  if (denX === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denX;
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  const ssTot = ys.reduce((s, y) => s + (y - meanY) ** 2, 0);
  const ssRes = ys.reduce((s, y, i) => s + (y - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  const sse = Math.sqrt(ssRes / Math.max(1, n - 2));
  return { slope, intercept, r2, sse, n };
}

function predict(model, x) {
  const yHat = model.slope * x + model.intercept;
  const ci = 1.96 * model.sse;
  return { value: yHat, lower: yHat - ci, upper: yHat + ci };
}

// ─── FORECASTING ───
function forecastTimeSeries(values, steps = 5) {
  if (!values || values.length < 4) return null;
  const ys = values.map(v => Number(v)).filter(v => !isNaN(v));
  if (ys.length < 4) return null;
  const xs = ys.map((_, i) => i);
  const model = linearRegression(xs, ys);
  if (!model) return null;
  const forecast = [];
  for (let i = 0; i < steps; i++) {
    const x = ys.length + i;
    const p = predict(model, x);
    forecast.push({ step: i + 1, value: round(p.value), lower: round(p.lower), upper: round(p.upper) });
  }
  return {
    forecast,
    model: {
      slope: round(model.slope, 4), intercept: round(model.intercept, 4),
      r2: round(model.r2, 4),
      direction: model.slope > 0.01 ? 'increasing' : model.slope < -0.01 ? 'decreasing' : 'flat',
      confidence: model.r2 > 0.7 ? 'high' : model.r2 > 0.4 ? 'medium' : 'low',
    },
  };
}

// ─── ANOMALY DETECTION ───
function detectAnomalies(values) {
  const nums = values.map(v => Number(v)).filter(v => !isNaN(v));
  if (nums.length < 8) return [];
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  const std = Math.sqrt(nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length);
  const sorted = [...nums].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const anomalies = [];
  values.forEach((v, idx) => {
    const num = Number(v);
    if (isNaN(num)) return;
    const z = std > 0 ? Math.abs(num - mean) / std : 0;
    const isOutlier = num < lowerFence || num > upperFence;
    if (z > 2.5 || isOutlier) {
      anomalies.push({ index: idx, value: round(num), zScore: round(z, 2), severity: z > 3 ? 'extreme' : 'mild' });
    }
  });
  return anomalies;
}

// ─── PER-CHART INSIGHTS ───
const INSIGHT_SAMPLE_SIZE = 20000;
function sampleForInsights(data) {
  if (data.length <= INSIGHT_SAMPLE_SIZE) return data;
  const step = data.length / INSIGHT_SAMPLE_SIZE;
  const sample = [];
  for (let i = 0; i < INSIGHT_SAMPLE_SIZE; i++) sample.push(data[Math.floor(i * step)]);
  return sample;
}

function generateExpertInsights(spec, dataFull, columns) {
  const ins = [];
  // Sample for performance — full-data analysis on 200K rows is too slow
  const data = sampleForInsights(dataFull);
  const yCol = columns.find(c => c.name === spec.y);
  const xCol = columns.find(c => c.name === spec.x);

  try {
    // BAR / PIE / DONUT / TREEMAP / FUNNEL — top performer + concentration
    if (['bar', 'horizontal_bar', 'pie', 'donut', 'treemap', 'funnel', 'map'].includes(spec.type) && spec.x && spec.y) {
      const agg = {};
      data.forEach(r => { const k = String(r[spec.x] ?? 'Unknown'); agg[k] = (agg[k] || 0) + (Number(r[spec.y]) || 0); });
      const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]);
      if (sorted.length >= 2) {
        const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
        const top = sorted[0]; const topPct = (top[1] / total) * 100;
        ins.push({ type: 'top', text: `'${top[0]}' leads with ${formatVal(top[1], yCol)} (${round(topPct)}% of total).` });
        if (sorted.length >= 3) {
          const bot = sorted[sorted.length - 1];
          ins.push({ type: 'bottom', text: `Lowest: '${bot[0]}' at ${formatVal(bot[1], yCol)} — ${round((bot[1] / top[1]) * 100)}% of leader.` });
        }
        if (topPct > 40) ins.push({ type: 'risk', text: `⚠️ Concentration risk: top ${spec.x} accounts for >40% of total.` });
      }
    }
    // LINE / AREA — trend + forecast (aggregates by x first to handle duplicates)
    else if (['line', 'area', 'multi_line', 'stacked_area'].includes(spec.type) && spec.x && spec.y) {
      // Aggregate by x value first (sum)
      const agg = {};
      data.forEach(r => {
        const k = String(r[spec.x] ?? 'Unknown');
        const v = Number(r[spec.y]);
        if (!isNaN(v)) agg[k] = (agg[k] || 0) + v;
      });
      // Sort by x using subtype-aware sort if available
      const xColLocal = columns.find(c => c.name === spec.x);
      const subtype = xColLocal?.subtype;
      let entries = Object.entries(agg);
      if (subtype === 'month_name') {
        const ORDER = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
        entries.sort((a, b) => (ORDER[a[0].toLowerCase()] || 99) - (ORDER[b[0].toLowerCase()] || 99));
      } else if (subtype === 'year' || subtype === 'month_num') {
        entries.sort((a, b) => Number(a[0]) - Number(b[0]));
      } else {
        entries.sort((a, b) => {
          const ad = new Date(a[0]), bd = new Date(b[0]);
          return !isNaN(ad) && !isNaN(bd) ? ad - bd : a[0].localeCompare(b[0]);
        });
      }
      if (entries.length >= 3) {
        const yvals = entries.map(e => e[1]);
        const xLabels = entries.map(e => e[0]);

        // Trend direction (start to end)
        const first = yvals[0], last = yvals[yvals.length - 1];
        const pctChange = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
        const dir = pctChange > 5 ? 'rising' : pctChange < -5 ? 'falling' : 'flat';
        if (Math.abs(pctChange) > 1) {
          ins.push({ type: 'trend', text: `${dir} trend (${pctChange > 0 ? '+' : ''}${round(pctChange)}%) — from ${formatVal(first, yCol)} in ${xLabels[0]} to ${formatVal(last, yCol)} in ${xLabels[xLabels.length-1]}.` });
        }

        // Peak (highest value)
        let maxIdx = 0;
        for (let i = 1; i < yvals.length; i++) if (yvals[i] > yvals[maxIdx]) maxIdx = i;
        const avgY = yvals.reduce((s, v) => s + v, 0) / yvals.length;
        if (yvals[maxIdx] > avgY * 1.3) {
          ins.push({ type: 'top', text: `Peak in ${xLabels[maxIdx]} at ${formatVal(yvals[maxIdx], yCol)} — ${round((yvals[maxIdx] / avgY - 1) * 100)}% above average.` });
        }

        // Trough (lowest value)
        let minIdx = 0;
        for (let i = 1; i < yvals.length; i++) if (yvals[i] < yvals[minIdx]) minIdx = i;
        if (yvals[minIdx] < avgY * 0.7 && yvals[minIdx] !== yvals[maxIdx]) {
          ins.push({ type: 'bottom', text: `Lowest in ${xLabels[minIdx]} at ${formatVal(yvals[minIdx], yCol)} — ${round((1 - yvals[minIdx] / avgY) * 100)}% below average.` });
        }

        // Biggest jump (period-over-period)
        let bigJumpIdx = -1, bigJumpDelta = 0;
        for (let i = 1; i < yvals.length; i++) {
          const delta = yvals[i] - yvals[i - 1];
          if (Math.abs(delta) > Math.abs(bigJumpDelta)) {
            bigJumpDelta = delta;
            bigJumpIdx = i;
          }
        }
        if (bigJumpIdx > 0 && Math.abs(bigJumpDelta) > avgY * 0.3) {
          const verb = bigJumpDelta > 0 ? 'jumped' : 'dropped';
          ins.push({ type: 'anomaly', text: `Biggest change: ${verb} ${formatVal(Math.abs(bigJumpDelta), yCol)} between ${xLabels[bigJumpIdx-1]} and ${xLabels[bigJumpIdx]}.` });
        }

        // Forecast
        const fc = forecastTimeSeries(yvals, 3);
        if (fc && fc.model.r2 > 0.4) {
          const future = fc.forecast[2].value;
          const futurePct = last !== 0 ? ((future - last) / Math.abs(last)) * 100 : 0;
          ins.push({ type: 'forecast', text: `Forecast: ${formatVal(future, yCol)} in 3 periods (${futurePct > 0 ? '+' : ''}${round(futurePct)}%, R²=${fc.model.r2.toFixed(2)}).` });
        }
      }
    }
    // SCATTER / BUBBLE — correlation + predictive
    else if (spec.type === 'scatter' || spec.type === 'bubble') {
      const pairs = data.map(r => [Number(r[spec.x]), Number(r[spec.y])]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
      if (pairs.length >= 5) {
        const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
        const m = linearRegression(xs, ys);
        if (m) {
          const r = Math.sign(m.slope) * Math.sqrt(Math.max(0, m.r2));
          const strength = Math.abs(r) > 0.7 ? 'strong' : Math.abs(r) > 0.4 ? 'moderate' : 'weak';
          const dir = r > 0 ? 'positive' : 'negative';
          ins.push({ type: 'correlation', text: `${strength} ${dir} correlation (r=${r.toFixed(2)}, R²=${m.r2.toFixed(2)}).` });
          if (Math.abs(r) > 0.5) ins.push({ type: 'predictor', text: `Predictive: as ${spec.x} increases by 1, ${spec.y} ${m.slope > 0 ? '+' : ''}${formatSlope(m.slope, yCol)}.` });
        }
      }
    }
    // HISTOGRAM — distribution shape + outliers
    else if (spec.type === 'histogram' && yCol?.stats) {
      const skew = yCol.stats.skewness || 0;
      const shape = Math.abs(skew) > 1 ? (skew > 0 ? 'right-skewed (long upper tail)' : 'left-skewed (long lower tail)') : 'roughly symmetric';
      ins.push({ type: 'shape', text: `Distribution: ${shape}.` });
      ins.push({ type: 'center', text: `Central value: ${formatVal(yCol.stats.median, yCol)} (median), spread σ=${formatVal(yCol.stats.stdDev, yCol)}.` });
      if (yCol.stats.outlierCount > 0) ins.push({ type: 'anomaly', text: `${yCol.stats.outlierCount} outliers detected via IQR.` });
    }
    // HEATMAP — hot/cold cells
    else if (spec.type === 'heatmap' && spec.x && spec.y && spec.value) {
      const cells = {};
      data.forEach(r => { const k = `${r[spec.x]}|${r[spec.y]}`; cells[k] = (cells[k] || 0) + (Number(r[spec.value]) || 0); });
      const sorted = Object.entries(cells).sort((a, b) => b[1] - a[1]);
      if (sorted.length) {
        const [top, val] = sorted[0]; const [tx, ty] = top.split('|');
        ins.push({ type: 'hotspot', text: `Hottest cell: ${tx} × ${ty} = ${formatVal(val, columns.find(c => c.name === spec.value))}.` });
        const [cold, cval] = sorted[sorted.length - 1];
        if (cval !== val) {
          const [cx, cy] = cold.split('|');
          ins.push({ type: 'coldspot', text: `Coolest: ${cx} × ${cy} = ${formatVal(cval, columns.find(c => c.name === spec.value))}.` });
        }
      }
    }
    // BOX PLOT — group medians + variance
    else if (spec.type === 'box_plot' && spec.x && spec.y) {
      const groups = {};
      data.forEach(r => { const k = String(r[spec.x] ?? 'Unknown'); if (!groups[k]) groups[k] = []; const v = Number(r[spec.y]); if (!isNaN(v)) groups[k].push(v); });
      const medians = Object.entries(groups).map(([k, vs]) => { const s = [...vs].sort((a, b) => a - b); return [k, s[Math.floor(s.length / 2)] || 0]; });
      medians.sort((a, b) => b[1] - a[1]);
      if (medians.length >= 2) {
        ins.push({ type: 'top', text: `Highest median: '${medians[0][0]}' at ${formatVal(medians[0][1], yCol)}.` });
        ins.push({ type: 'bottom', text: `Lowest median: '${medians[medians.length - 1][0]}' at ${formatVal(medians[medians.length - 1][1], yCol)}.` });
      }
    }
    // FORECAST chart - already shows the prediction
    else if (spec.type === 'forecast' && yCol) {
      ins.push({ type: 'forecast', text: `Linear projection of ${spec.y}. Shaded band shows 95% confidence interval.` });
    }
    // MAP - geographic
    else if (spec.type === 'map' && spec.x && spec.y) {
      const agg = {};
      data.forEach(r => { const k = String(r[spec.x] ?? 'Unknown'); agg[k] = (agg[k] || 0) + (Number(r[spec.y]) || 0); });
      const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]);
      if (sorted.length) {
        ins.push({ type: 'geo-top', text: `Top region: ${sorted[0][0]} with ${formatVal(sorted[0][1], yCol)}.` });
        if (sorted.length > 3) ins.push({ type: 'geo-spread', text: `Distributed across ${sorted.length} regions.` });
      }
    }
    // WORD CLOUD - dominant words
    else if (spec.type === 'word_cloud' && xCol?.stats?.topWords) {
      const top3 = xCol.stats.topWords.slice(0, 3).map(w => `'${w.word}'`).join(', ');
      ins.push({ type: 'words', text: `Most frequent words: ${top3}.` });
    }
  } catch (e) { /* fail silently */ }

  return ins;
}

// ─── EXECUTIVE RECOMMENDATIONS ───
function generateExecutiveRecommendations(columns, dataFull) {
  const recs = [];
  const data = sampleForInsights(dataFull);
  const num = columns.filter(c => c.type === 'numeric');
  const cat = columns.filter(c => c.type === 'categorical');
  const time = columns.filter(c => c.type === 'temporal');
  const text = columns.filter(c => c.type === 'text');

  // 1. CONCENTRATION RISK (any money-like column + categorical breakdown)
  const moneyCol = num.find(c => c.semantic === 'currency' || /revenue|sales|profit|amount|price/i.test(c.name));
  const primaryNum = moneyCol || num[0];
  if (primaryNum && cat.length) {
    // Scan ALL categorical columns and report the strongest concentration signal
    let bestSignal = null;
    for (const c of cat.slice(0, 4)) {
      const agg = {};
      data.forEach(r => { const k = String(r[c.name] ?? 'Unknown'); agg[k] = (agg[k] || 0) + (Number(r[primaryNum.name]) || 0); });
      const sorted = Object.entries(agg).sort((a, b) => b[1] - a[1]);
      if (sorted.length < 2) continue;
      const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
      const topPct = (sorted[0][1] / total) * 100;
      // Score: prefer high concentration with enough categories to be meaningful
      const score = sorted.length >= 3 ? topPct : topPct * 0.5;
      if (!bestSignal || score > bestSignal.score) {
        bestSignal = { c, sorted, total, topPct, score };
      }
    }
    if (bestSignal) {
      const { c, sorted, total, topPct } = bestSignal;
      const isMoneyMetric = primaryNum === moneyCol;
      const metricVerb = isMoneyMetric ? 'generates' : 'accounts for';
      const metricNoun = isMoneyMetric ? `of ${primaryNum.name}` : `of ${primaryNum.name} share`;
      if (topPct > 50) {
        recs.push({
          priority: 'high', icon: '⚠️', type: 'concentration-risk',
          title: `Concentration Risk in ${c.name}`,
          text: `'${sorted[0][0]}' ${metricVerb} ${round(topPct)}% ${metricNoun}. Heavy dependence creates business risk — consider diversifying ${c.name} portfolio.`,
        });
      } else if (topPct > 30 && sorted.length >= 4) {
        recs.push({
          priority: 'medium', icon: '🎯', type: 'top-performer',
          title: `Top Performer: ${sorted[0][0]}`,
          text: `'${sorted[0][0]}' drives ${round(topPct)}% ${metricNoun} — invest in protecting and scaling this segment.`,
        });
      }
      // Long-tail / bottom segments
      if (sorted.length >= 5) {
        const tail = sorted.slice(-Math.ceil(sorted.length / 3));
        const tailPct = tail.reduce((s, [, v]) => s + v, 0) / total * 100;
        if (tailPct < 10) {
          recs.push({
            priority: 'medium', icon: '🔍', type: 'opportunity',
            title: `${tail.length} ${c.name} Underperforming`,
            text: `Bottom ${tail.length} ${c.name} values contribute only ${round(tailPct)}% ${metricNoun}. Either invest in growth or sunset to free up resources.`,
          });
        }
      }
    }
  }

  // 2. FORECAST (any time + numeric)
  if (time.length && num.length) {
    const t = time[0];
    const sorted = [...data].sort((a, b) => new Date(a[t.name]) - new Date(b[t.name]));
    const targetCols = [primaryNum, ...num.filter(c => c !== primaryNum).slice(0, 1)].filter(Boolean);
    for (const n of targetCols) {
      const yvals = sorted.map(r => Number(r[n.name])).filter(v => !isNaN(v));
      if (yvals.length >= 6) {
        const fc = forecastTimeSeries(yvals, 5);
        if (fc && fc.model.r2 > 0.3) {
          const last = yvals[yvals.length - 1];
          const future = fc.forecast[4]?.value;
          const pctChange = last !== 0 ? ((future - last) / Math.abs(last)) * 100 : 0;
          // Always include forecast (drop the >10% threshold)
          const isPositive = pctChange > 0;
          const isMaterial = Math.abs(pctChange) >= 3;
          recs.push({
            priority: pctChange < -10 ? 'high' : isMaterial ? 'medium' : 'low',
            icon: isPositive ? '📈' : pctChange < -1 ? '📉' : '➡️',
            type: isPositive ? 'forecast-positive' : 'forecast-negative',
            title: `${n.name} Forecast: ${pctChange > 0 ? '+' : ''}${round(pctChange)}% over 5 periods`,
            text: `Linear regression projects ${n.name} ${isPositive ? 'rising to' : 'falling to'} ${formatVal(future, n)} from current ${formatVal(last, n)}. Model confidence: ${fc.model.confidence} (R²=${fc.model.r2.toFixed(2)}).`,
          });
        }
      }
    }
  }

  // 3. STRONG PREDICTOR (correlation pairs)
  if (num.length >= 2) {
    let strongest = null;
    for (let i = 0; i < num.length; i++) {
      for (let j = i + 1; j < num.length; j++) {
        const pairs = data.map(r => [Number(r[num[i].name]), Number(r[num[j].name])]).filter(([a, b]) => !isNaN(a) && !isNaN(b));
        if (pairs.length < 5) continue;
        const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
        const m = linearRegression(xs, ys);
        if (m && m.r2 > (strongest?.r2 || 0.5)) {
          strongest = { col1: num[i].name, col2: num[j].name, r2: m.r2, slope: m.slope };
        }
      }
    }
    if (strongest) {
      recs.push({
        priority: 'medium', icon: '🔗', type: 'predictor',
        title: `Strong Predictor: ${strongest.col1} ↔ ${strongest.col2}`,
        text: `These two metrics move together (R²=${round(strongest.r2, 2)}). Use ${strongest.col1} to predict ${strongest.col2} or investigate the underlying driver.`,
      });
    }
  }

  // 4. ANOMALY ALERT (any numeric with many outliers)
  num.forEach(c => {
    const out = c.stats?.outlierCount || 0;
    if (out >= 5 && out / data.length > 0.02) {
      recs.push({
        priority: 'medium', icon: '🚨', type: 'anomaly',
        title: `${out} Anomalies in ${c.name}`,
        text: `${round(out / data.length * 100, 1)}% of ${c.name} values fall outside the IQR boundaries (${formatVal(c.stats.lowerFence, c)} to ${formatVal(c.stats.upperFence, c)}). These may be data errors or rare events worth investigating.`,
      });
    }
  });

  // 5. SEASONAL/CYCLIC PATTERN (time series with consistent variation)
  if (time.length && num.length) {
    const t = time[0]; const n = primaryNum || num[0];
    if (n) {
      const sorted = [...data].sort((a, b) => new Date(a[t.name]) - new Date(b[t.name]));
      const yvals = sorted.map(r => Number(r[n.name])).filter(v => !isNaN(v));
      if (yvals.length >= 14) {
        // Simple variance check across rolling windows
        const winSize = Math.floor(yvals.length / 4);
        const wins = [];
        for (let i = 0; i + winSize <= yvals.length; i += winSize) {
          const slice = yvals.slice(i, i + winSize);
          const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
          wins.push(mean);
        }
        if (wins.length >= 3) {
          const winMean = wins.reduce((s, v) => s + v, 0) / wins.length;
          const winVar = wins.reduce((s, v) => s + (v - winMean) ** 2, 0) / wins.length;
          const cv = Math.sqrt(winVar) / Math.abs(winMean || 1);
          if (cv > 0.15) {
            recs.push({
              priority: 'low', icon: '🔄', type: 'pattern',
              title: `Cyclic Pattern in ${n.name}`,
              text: `${n.name} shows ${round(cv * 100)}% coefficient of variation across time windows — likely seasonality or recurring cycles. Consider time-of-period analysis (day/week/month).`,
            });
          }
        }
      }
    }
  }

  // 6. DATA QUALITY ALERT
  const totalNulls = num.concat(cat).reduce((s, c) => s + (c.stats?.nullCount || 0), 0);
  const nullPct = (totalNulls / (data.length * columns.length)) * 100;
  if (nullPct > 5) {
    recs.push({
      priority: nullPct > 15 ? 'high' : 'medium', icon: '🧹', type: 'quality',
      title: `Missing Data: ${round(nullPct)}% of cells are empty`,
      text: `${totalNulls} missing values detected. Use the Cleaning tab to fill or drop them — analysis quality improves significantly with complete data.`,
    });
  }

  // 7. TEXT INSIGHTS (if text columns present)
  if (text.length) {
    text.forEach(c => {
      if (c.stats?.topWords?.length >= 3) {
        const top3 = c.stats.topWords.slice(0, 3).map(w => `${w.word} (${w.count})`).join(', ');
        recs.push({
          priority: 'low', icon: '💬', type: 'text-insight',
          title: `Top Themes in ${c.name}`,
          text: `Most frequent words: ${top3}. Consider word cloud visualization or NLP categorization.`,
        });
      }
    });
  }

  // Sort by priority then by recency, max 6
  return recs.sort((a, b) => {
    const pri = { high: 0, medium: 1, low: 2 };
    return pri[a.priority] - pri[b.priority];
  }).slice(0, 6);
}

// ─── HELPERS ───
function formatVal(val, col) {
  if (val === undefined || val === null || isNaN(val)) return String(val);
  const n = Number(val);
  const sem = col?.semantic;
  if (sem === 'currency') {
    if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1000) return `$${(n / 1000).toFixed(1)}K`;
    return `$${round(n)}`;
  }
  if (sem === 'percent') return `${round(n)}%`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(round(n));
}

function formatSlope(slope, col) {
  return formatVal(slope, col);
}

module.exports = {
  generateExpertInsights,
  generateExecutiveRecommendations,
  forecastTimeSeries,
  detectAnomalies,
  linearRegression,
  formatVal,
};
