const express = require('express');
const learning = require('../utils/learningEngine');
const memory = require('../utils/visualizationMemory');
const datasetStore = require('../utils/datasetStore');

const router = express.Router();

// Record feedback (accept/dismiss) on a chart
router.post('/:id/feedback', (req, res) => {
  try {
    const ds = datasetStore.get(req.params.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });

    const { chartType, action, spec } = req.body;
    if (!chartType || !['accept', 'dismiss'].includes(action)) {
      return res.status(400).json({ error: 'chartType and action (accept/dismiss) required' });
    }

    const cols = ds.analysis.columns;
    const ctx = {
      numCount: cols.filter(c => c.type === 'numeric').length,
      catCount: cols.filter(c => c.type === 'categorical').length,
      timeCount: cols.filter(c => c.type === 'temporal').length,
    };

    if (action === 'accept') learning.recordAccept(chartType, ctx);
    else learning.recordDismiss(chartType, ctx);

    // Also update visualization memory if chart spec was provided
    if (spec) {
      try { memory.recordFeedback(spec, cols, ds.id, action); }
      catch (err) { console.warn('Memory feedback err:', err.message); }
    }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Combined learning + memory stats
router.get('/stats', (req, res) => {
  try {
    const learnStats = learning.getStats();
    let memStats = { stats: {}, topAcceptedTypes: [], recentMemories: [] };
    try { memStats = memory.getStats(); } catch (err) { console.warn(err.message); }
    res.json({
      learning: learnStats,
      memory: memStats,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reset', (req, res) => {
  const { target } = req.body || {};
  if (target === 'memory' || target === 'all') memory.reset();
  if (target === 'learning' || target === 'all' || !target) learning.reset();
  res.json({ success: true });
});

router.delete('/memory/:id', (req, res) => {
  const ok = memory.deleteMemory(req.params.id);
  res.json({ deleted: ok });
});

module.exports = router;
