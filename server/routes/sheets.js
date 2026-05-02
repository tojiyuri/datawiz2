const express = require('express');
const sheetStore = require('../utils/sheetStore');
const datasetStore = require('../utils/datasetStore');
const { buildChartFromSheet } = require('../utils/sheetSpecBuilder');
const { generateExpertInsights } = require('../utils/insightEngine');

const router = express.Router();

// POST /api/sheets/render - given dataset + spec, return chart data (no save)
router.post('/render', (req, res) => {
  try {
    const { datasetId, spec } = req.body;
    const ds = datasetStore.get(datasetId, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found', expired: true });
    if (!spec || !spec.chartType) return res.status(400).json({ error: 'Spec with chartType required' });

    const result = buildChartFromSheet(spec, ds);
    let insights = [];
    try {
      if (result.spec && result.chartData?.length) {
        insights = generateExpertInsights(result.spec, ds.data, ds.analysis.columns);
      }
    } catch {}
    res.json({
      spec: result.spec,
      chartData: result.chartData,
      stackKeys: result.stackKeys || result.chartData?._stackKeys,
      insights,
      warnings: result.warnings || [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/sheets - list (filter by datasetId optionally)
router.get('/', (req, res) => {
  res.json({ sheets: sheetStore.listSheets(req.query.datasetId, req.user?.id) });
});

// GET /api/sheets/:id - get one sheet with rendered chart data
router.get('/:id', (req, res) => {
  const sheet = sheetStore.getSheet(req.params.id, req.user?.id);
  if (!sheet) return res.status(404).json({ error: 'Sheet not found' });
  const ds = datasetStore.get(sheet.datasetId, req.user?.id);
  if (!ds) return res.json({ sheet, chartData: null, expired: true });
  try {
    const result = buildChartFromSheet(sheet.spec, ds);
    let insights = [];
    try {
      if (result.spec && result.chartData?.length) {
        insights = generateExpertInsights(result.spec, ds.data, ds.analysis.columns);
      }
    } catch {}
    res.json({
      sheet,
      chartSpec: result.spec,
      chartData: result.chartData,
      stackKeys: result.stackKeys || result.chartData?._stackKeys,
      insights,
      warnings: result.warnings || [],
    });
  } catch (err) {
    res.json({ sheet, chartData: null, error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, datasetId, spec } = req.body;
    if (!datasetId || !spec) return res.status(400).json({ error: 'datasetId and spec required' });
    const ds = datasetStore.get(datasetId, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found or access denied' });
    const datasetName = ds?.fileName || 'unknown';
    const sheet = sheetStore.createSheet({ name, datasetId, datasetName, spec, ownerId: req.user?.id });
    res.json({ sheet });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const updated = sheetStore.updateSheet(req.params.id, req.body, req.user?.id);
  if (!updated) return res.status(404).json({ error: 'Sheet not found or access denied' });
  res.json({ sheet: updated });
});

router.delete('/:id', (req, res) => {
  res.json({ deleted: sheetStore.deleteSheet(req.params.id, req.user?.id) });
});

// POST /api/sheets/validate-formula - check syntax and field refs without rendering
router.post('/validate-formula', (req, res) => {
  const { formula, datasetId } = req.body;
  if (!formula) return res.json({ ok: false, error: 'Empty formula' });
  const { validate } = require('../utils/formulaEngine');
  const ds = datasetStore.get(datasetId, req.user?.id);
  const colNames = ds ? ds.analysis.columns.map(c => c.name) : [];
  const result = validate(formula, colNames);
  res.json({
    ok: result.ok,
    error: result.error,
    missing: result.missing,
    isAggregate: result.isAggregate,
  });
});

// GET /api/sheets/filter-options/:datasetId/:field - distinct values + range for a field
router.get('/filter-options/:datasetId/:field', (req, res) => {
  const ds = datasetStore.get(req.params.datasetId, req.user?.id);
  if (!ds) return res.status(404).json({ error: 'Dataset not found' });
  const { getDistinctValues, getNumericRange } = require('../utils/filterEngine');
  const field = req.params.field;
  const col = ds.analysis.columns.find(c => c.name === field);
  if (!col) return res.json({ field, values: [] });
  if (col.type === 'numeric' && col.subtype !== 'identifier') {
    res.json({ field, type: 'numeric', range: getNumericRange(ds.data, field) });
  } else {
    res.json({ field, type: 'categorical', values: getDistinctValues(ds.data, field, 200) });
  }
});

// POST /api/sheets/converse - multi-turn natural language sheet builder (LLM-powered with heuristic fallback)
router.post('/converse', async (req, res) => {
  try {
    const { message, currentSpec, datasetId, history = [] } = req.body;
    const ds = datasetStore.get(datasetId, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });

    const llmEngine = require('../utils/llmConversationEngine');
    const result = await llmEngine.converse({
      message,
      currentSpec,
      datasetId,
      history,
      dataset: ds.analysis,
    });
    res.json(result);
  } catch (err) {
    console.error('[converse] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sheets/suggest-calc-fields/:datasetId - propose KPIs (LLM-powered with heuristic fallback)
router.get('/suggest-calc-fields/:datasetId', async (req, res) => {
  try {
    const ds = datasetStore.get(req.params.datasetId, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });

    const llmSuggester = require('../utils/llmCalcSuggester');
    const suggestions = await llmSuggester.suggest(ds.analysis);
    res.json({ suggestions });
  } catch (err) {
    console.error('[suggest-calc-fields] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sheets/ai-status - tell the frontend which provider is active
router.get('/ai-status', async (req, res) => {
  const llmEngine = require('../utils/llmConversationEngine');
  try {
    const provider = await llmEngine.describeProviderAsync();
    res.json({
      llmAvailable: provider.available,
      provider: provider.name,
      model: provider.model,
      location: provider.location,    // 'cloud' | 'local' | null
      mode: provider.available ? provider.name : 'heuristic',
    });
  } catch (err) {
    res.json({
      llmAvailable: false,
      provider: 'heuristic',
      mode: 'heuristic',
    });
  }
});

module.exports = router;
