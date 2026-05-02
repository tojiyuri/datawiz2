const express = require('express');
const NLPEngine = require('../utils/nlpEngine');
const { generateChartData } = require('../utils/chartDataGenerator');
const memory = require('../utils/visualizationMemory');
const datasetStore = require('../utils/datasetStore');
const router = express.Router();

router.post('/:id/query', (req, res) => {
  try {
    const ds = datasetStore.get(req.params.id, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
    if (!req.body.query?.trim()) return res.status(400).json({ error: 'Query required' });

    const spec = NLPEngine.parseQuery(req.body.query, ds.analysis.columns);
    const chartData = generateChartData(spec, ds.data, ds.analysis.columns);

    // Record in memory so NLP charts also benefit from learning
    try { memory.recordChart(spec, ds.analysis.columns, ds.id, ds.fileName); }
    catch (err) { console.warn('Memory record err:', err.message); }

    res.json({ spec, chartData, stackKeys: chartData?._stackKeys });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/suggestions', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
  res.json({ suggestions: NLPEngine.generateSuggestions(ds.analysis.columns) });
});

module.exports = router;
