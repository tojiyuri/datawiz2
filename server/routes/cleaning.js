const express = require('express');
const DataProcessor = require('../utils/dataProcessor');
const datasetStore = require('../utils/datasetStore');
const router = express.Router();

router.get('/:id/issues', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
  const issues = ds.analysis.issues || [];
  res.json({
    datasetId: ds.id, issues,
    summary: {
      total: issues.length,
      high: issues.filter(i => i.severity === 'high').length,
      medium: issues.filter(i => i.severity === 'medium').length,
      low: issues.filter(i => i.severity === 'low').length,
    },
  });
});

router.post('/:id/apply', (req, res) => {
  try {
    const ds = datasetStore.get(req.params.id, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
    const { action, column, params } = req.body;
    if (!action) return res.status(400).json({ error: 'Action required' });
    const result = DataProcessor.applyCleaningOperation(ds.data, ds.analysis.columns, { action, column, params });
    ds.data = result.data;
    ds.analysis = DataProcessor.analyzeDataset(ds.data);
    datasetStore.set(ds.id, ds); // re-persist
    res.json({
      success: true, action: result.action, column: result.column,
      affectedCount: result.affectedCount, newRowCount: ds.data.length, analysis: ds.analysis,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/auto-clean', (req, res) => {
  try {
    const ds = datasetStore.get(req.params.id, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
    const result = DataProcessor.autoClean(ds.data, ds.analysis.columns);
    ds.data = result.data;
    ds.analysis = DataProcessor.analyzeDataset(ds.data);
    datasetStore.set(ds.id, ds);
    res.json({
      success: true, log: result.log,
      originalCount: result.originalCount, cleanedCount: result.cleanedCount,
      analysis: ds.analysis,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id/download', (req, res) => {
  const ds = datasetStore.get(req.params.id, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });
  const cols = Object.keys(ds.data[0] || {});
  const rows = ds.data.map(r =>
    cols.map(c => {
      const v = String(r[c] ?? '');
      return v.includes(',') || v.includes('"') || v.includes('\n')
        ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(',')
  );
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="cleaned_${ds.fileName}"`);
  res.send([cols.join(','), ...rows].join('\n'));
});

module.exports = router;
