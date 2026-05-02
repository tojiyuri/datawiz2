/**
 * dashboardInsights - "What's interesting?" engine for dashboards.
 *
 * Given a dashboard with rendered tiles (each having chartData + spec),
 * scan for statistically interesting patterns across all tiles and return
 * the top N findings ranked by "surprise" (how far from the baseline).
 *
 * Findings:
 *   - outlier: one category dramatically dominates or is far below
 *   - top_mover: highest single value vs average
 *   - bottom_mover: lowest single value vs average
 *   - concentration: top 1-2 hold >X% of total
 *   - flat: low variance, nothing interesting
 *   - trend_up / trend_down: monotonic temporal data
 *   - reversal: trend changes direction
 *   - correlation: when two measures move together (multi-measure tiles)
 *   - imbalance: many categories with very few measurements
 */

function variance(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

function correlation(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx ** 2; dy2 += dy ** 2;
  }
  if (dx2 === 0 || dy2 === 0) return 0;
  return num / Math.sqrt(dx2 * dy2);
}

// Analyze a single tile's chart data
function analyzeTile(tile) {
  const out = [];
  const { sheet, chartData, chartSpec, stackKeys } = tile;
  if (!chartData || !Array.isArray(chartData) || chartData.length < 2) return out;
  if (!sheet || !chartSpec) return out;

  const xField = chartSpec.x;
  const yField = chartSpec.y;
  const isMultiMeasure = stackKeys && stackKeys.length > 1;
  const isTemporal = chartSpec.type === 'line' || chartSpec.type === 'area' || chartSpec.type === 'multi_line' || chartSpec.type === 'stacked_area' || chartSpec.type === 'forecast';

  if (isMultiMeasure) {
    // Multi-measure: look for correlation
    const k1 = stackKeys[0], k2 = stackKeys[1];
    const xs = chartData.map(d => Number(d[k1])).filter(v => !isNaN(v));
    const ys = chartData.map(d => Number(d[k2])).filter(v => !isNaN(v));
    if (xs.length === ys.length && xs.length >= 3) {
      const r = correlation(xs, ys);
      if (Math.abs(r) > 0.7) {
        out.push({
          type: r > 0 ? 'correlation_positive' : 'correlation_negative',
          score: Math.abs(r) * 100,
          tileId: tile.sheetId,
          tileName: sheet.name,
          text: `${k1} and ${k2} are ${r > 0 ? 'strongly correlated' : 'inversely correlated'} (r=${r.toFixed(2)}) in ${sheet.name}.`,
          icon: r > 0 ? '🔗' : '🔀',
        });
      }
    }
    return out;
  }

  if (!yField) return out;
  const values = chartData.map(d => Number(d[yField])).filter(v => !isNaN(v));
  if (!values.length) return out;
  const total = values.reduce((s, v) => s + v, 0);
  const mean = total / values.length;
  const std = Math.sqrt(variance(values));
  const max = Math.max(...values);
  const min = Math.min(...values);
  const sortedDesc = [...chartData].sort((a, b) => Number(b[yField]) - Number(a[yField]));

  // Outlier — one category much higher than rest
  if (std > 0 && max > mean + 2 * std && chartData.length >= 3) {
    const top = sortedDesc[0];
    out.push({
      type: 'outlier_high',
      score: ((max - mean) / std) * 20,
      tileId: tile.sheetId,
      tileName: sheet.name,
      text: `${top[xField]} stands out at ${formatNum(max)} — ${(max / mean).toFixed(1)}× the average for ${yField}.`,
      icon: '⚠️',
      reference: { field: xField, value: top[xField] },
    });
  }

  // Top mover (less strict than outlier)
  if (max > mean * 1.5 && chartData.length >= 3 && !out.find(o => o.type === 'outlier_high')) {
    out.push({
      type: 'top_mover',
      score: ((max - mean) / mean) * 60,
      tileId: tile.sheetId,
      tileName: sheet.name,
      text: `Top: ${sortedDesc[0][xField]} leads with ${formatNum(max)} (${((max / total) * 100).toFixed(0)}% of total).`,
      icon: '🏆',
    });
  }

  // Bottom mover
  if (min < mean * 0.4 && chartData.length >= 3) {
    const bottom = chartData.find(d => Number(d[yField]) === min);
    if (bottom) out.push({
      type: 'bottom_mover',
      score: ((mean - min) / mean) * 50,
      tileId: tile.sheetId,
      tileName: sheet.name,
      text: `Lowest: ${bottom[xField]} at ${formatNum(min)} — ${((1 - min / mean) * 100).toFixed(0)}% below average.`,
      icon: '📉',
    });
  }

  // Concentration (top 1-2 dominate)
  if (chartData.length >= 4) {
    const top2 = sortedDesc.slice(0, 2).reduce((s, d) => s + Number(d[yField]), 0);
    const concentration = top2 / total;
    if (concentration > 0.6) {
      out.push({
        type: 'concentration',
        score: concentration * 80,
        tileId: tile.sheetId,
        tileName: sheet.name,
        text: `Top 2 (${sortedDesc[0][xField]}, ${sortedDesc[1][xField]}) account for ${(concentration * 100).toFixed(0)}% of ${yField}.`,
        icon: '🎯',
      });
    }
  }

  // Trend (temporal)
  if (isTemporal && values.length >= 4) {
    let upCount = 0, downCount = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i-1]) upCount++;
      else if (values[i] < values[i-1]) downCount++;
    }
    const total_steps = values.length - 1;
    if (upCount / total_steps >= 0.75) {
      const change = ((values[values.length-1] - values[0]) / values[0]) * 100;
      out.push({
        type: 'trend_up',
        score: 60 + Math.min(30, Math.abs(change) / 2),
        tileId: tile.sheetId,
        tileName: sheet.name,
        text: `${yField} is trending up — ${change > 0 ? '+' : ''}${change.toFixed(0)}% over the period.`,
        icon: '📈',
      });
    } else if (downCount / total_steps >= 0.75) {
      const change = ((values[values.length-1] - values[0]) / values[0]) * 100;
      out.push({
        type: 'trend_down',
        score: 60 + Math.min(30, Math.abs(change) / 2),
        tileId: tile.sheetId,
        tileName: sheet.name,
        text: `${yField} is trending down — ${change.toFixed(0)}% over the period.`,
        icon: '📉',
      });
    }
  }

  return out;
}

function formatNum(n) {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.abs(n) >= 100 ? Math.round(n).toString() : n.toFixed(2);
}

// ─── PUBLIC ENTRY ───
function generateInsights(renderedTiles, max = 5) {
  const all = [];
  for (const tile of renderedTiles) {
    if (!tile.chartData) continue;
    all.push(...analyzeTile(tile));
  }
  // Sort by score, dedupe by tile (max 2 per tile)
  all.sort((a, b) => b.score - a.score);
  const tilesSeen = {};
  const result = [];
  for (const insight of all) {
    tilesSeen[insight.tileId] = (tilesSeen[insight.tileId] || 0) + 1;
    if (tilesSeen[insight.tileId] <= 2) result.push(insight);
    if (result.length >= max) break;
  }
  return result;
}

module.exports = { generateInsights, analyzeTile };
