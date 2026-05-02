const express = require('express');
const ChartRecommender = require('../utils/chartRecommender');
const { generateChartData } = require('../utils/chartDataGenerator');
const { generateExecutiveRecommendations } = require('../utils/insightEngine');
const memory = require('../utils/visualizationMemory');
const datasetStore = require('../utils/datasetStore');

const router = express.Router();

/**
 * Quality check: skip charts that are useless to show.
 * Returns a string reason to skip, or null if the chart is OK.
 */
function chartQualityIssue(rec, chartData) {
  if (!chartData) return 'no data';
  if (Array.isArray(chartData) && chartData.length === 0) return 'empty';

  // Single-category charts are useless ("Sudan: 100%")
  if (Array.isArray(chartData) && chartData.length === 1 &&
      ['pie', 'donut', 'treemap', 'funnel', 'gauge', 'map', 'sankey', 'sunburst', 'bar', 'horizontal_bar'].includes(rec.type)) {
    return 'single category';
  }

  // All-zero numeric charts (the Y axis is just zeros — usually wrong column type)
  if (['bar', 'horizontal_bar', 'line', 'area', 'multi_line', 'stacked_area', 'pie', 'donut'].includes(rec.type)) {
    const yKey = rec.y;
    if (yKey && Array.isArray(chartData)) {
      const yVals = chartData.map(d => Number(d[yKey] || d.value || 0)).filter(v => !isNaN(v));
      if (yVals.length > 0 && yVals.every(v => v === 0)) return 'all zeros';
    }
  }

  // All values identical = boring chart (e.g. "Year by Month" where every month sums to same year value)
  if (['bar', 'horizontal_bar', 'line', 'area'].includes(rec.type)) {
    const yKey = rec.y;
    if (yKey && Array.isArray(chartData) && chartData.length >= 3) {
      const yVals = chartData.map(d => Number(d[yKey] || 0)).filter(v => !isNaN(v));
      if (yVals.length >= 3) {
        const min = Math.min(...yVals), max = Math.max(...yVals);
        const range = max - min;
        const mean = yVals.reduce((s, v) => s + v, 0) / yVals.length;
        // Coefficient of variation < 0.5% means values are essentially identical
        if (Math.abs(mean) > 0 && range / Math.abs(mean) < 0.005) return 'no variation';
      }
    }
  }

  return null;
}

router.get('/:id', (req, res) => {
  try {
    const ds = datasetStore.get(req.params.id, req.user?.id);
    if (!ds) return res.status(404).json({
      error: 'Dataset not found. Please re-upload.', expired: true,
    });

    let recs, similarMemoriesCount = 0;
    try {
      const result = ChartRecommender.recommend(
        ds.analysis.columns, ds.data,
        { id: ds.id, fileName: ds.fileName }
      );
      recs = result.recommendations;
      similarMemoriesCount = result.similarMemoriesCount;
    } catch (err) {
      console.error('Recommend error:', err);
      return res.status(500).json({ error: 'Recommendation engine failed: ' + err.message });
    }

    // Generate chart data with per-chart error handling AND quality filtering
    const charts = [];
    const skipped = [];
    for (const rec of recs) {
      try {
        const chartData = generateChartData(rec, ds.data, ds.analysis.columns);
        const issue = chartQualityIssue(rec, chartData);
        if (issue) {
          skipped.push(`${rec.type}/${rec.x}/${rec.y}: ${issue}`);
          continue;
        }
        charts.push({ ...rec, chartData, stackKeys: chartData?._stackKeys });
      } catch (err) {
        console.warn(`Chart ${rec.type} failed for ${rec.x}/${rec.y}: ${err.message}`);
      }
    }
    if (skipped.length) console.log(`  📉 Skipped ${skipped.length} low-quality charts: ${skipped.slice(0, 3).join('; ')}`);

    // Executive recommendations - the data scientist brain
    let executiveRecs = [];
    try {
      executiveRecs = generateExecutiveRecommendations(ds.analysis.columns, ds.data);
    } catch (err) { console.warn('Exec recs error:', err.message); }

    // Smart key metrics - skip year/identifier/coordinate columns (not real measures)
    const realMetrics = ds.analysis.columns.filter(c =>
      c.type === 'numeric' &&
      c.subtype !== 'identifier' &&
      c.subtype !== 'coordinate' &&
      c.subtype !== 'year'
    );
    const keyMetrics = realMetrics.slice(0, 4).map(c => ({
      name: c.name, value: c.stats?.sum ?? c.stats?.mean ?? 0,
      mean: c.stats?.mean ?? 0, min: c.stats?.min ?? 0, max: c.stats?.max ?? 0,
    }));

    let recalled = [];
    try {
      recalled = memory.getTopMemories(ds.analysis.columns, 4)
        .filter(m => m.datasetId !== ds.id)
        .map(r => ({
          id: r.id, chartType: r.chartType, title: r.title,
          accepts: r.accepts, dismisses: r.dismisses,
          datasetName: r.datasetName,
          similarity: Math.round(r.similarity * 100),
          x: r.x, y: r.y,
        }));
    } catch (err) { console.warn('Memory recall error:', err.message); }

    res.json({
      datasetId: ds.id, fileName: ds.fileName,
      summary: ds.analysis.summary, keyMetrics, charts,
      recommendations: executiveRecs,
      memory: { similarMemoriesCount, recalled },
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
