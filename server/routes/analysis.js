const express = require('express');
const ChartRecommender = require('../utils/chartRecommender');
const { generateChartData } = require('../utils/chartDataGenerator');
const datasetStore = require('../utils/datasetStore');
const router = express.Router();

router.get('/:id', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
  res.json(ds.analysis);
});

router.get('/:id/recommendations', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
  try {
    const { recommendations } = ChartRecommender.recommend(
      ds.analysis.columns, ds.data, { id: ds.id, fileName: ds.fileName }
    );
    res.json({ recommendations });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/chart-data', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
  try {
    const chartData = generateChartData(req.body, ds.data, ds.analysis.columns);
    res.json({ chartData, stackKeys: chartData?._stackKeys, spec: req.body });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/analysis/:id/explore — auto-discover findings across the whole dataset
// Returns a ranked list of statistical findings the user can explore.
router.get('/:id/explore', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });
  try {
    const autoExplore = require('../utils/autoExplore');
    const max = parseInt(req.query.max, 10) || 10;
    const findings = autoExplore.explore({ dataset: ds, maxFindings: max });
    res.json({ findings, datasetRows: ds.data.length });
  } catch (err) {
    console.error('[explore] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
