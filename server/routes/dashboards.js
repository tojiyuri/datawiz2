const express = require('express');
const sheetStore = require('../utils/sheetStore');
const datasetStore = require('../utils/datasetStore');
const { buildChartFromSheet } = require('../utils/sheetSpecBuilder');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ dashboards: sheetStore.listDashboards(req.query.datasetId, req.user?.id) });
});

router.get('/:id', (req, res) => {
  const db = sheetStore.getDashboard(req.params.id, req.user?.id);
  if (!db) return res.status(404).json({ error: 'Dashboard not found' });
  const ds = datasetStore.get(db.datasetId, req.user?.id);
  const renderedTiles = (db.tiles || []).map(tile => {
    const sheet = sheetStore.getSheet(tile.sheetId, req.user?.id);
    if (!sheet || !ds) return { ...tile, sheet, chartData: null };
    try {
      const result = buildChartFromSheet(sheet.spec, ds);
      return {
        ...tile, sheet,
        chartSpec: result.spec,
        chartData: result.chartData,
        stackKeys: result.stackKeys || result.chartData?._stackKeys,
      };
    } catch (err) { return { ...tile, sheet, chartData: null, error: err.message }; }
  });
  res.json({ dashboard: db, tiles: renderedTiles, datasetMissing: !ds });
});

router.post('/', (req, res) => {
  try {
    const { name, datasetId, tiles } = req.body;
    if (!datasetId) return res.status(400).json({ error: 'datasetId required' });
    const ds = datasetStore.get(datasetId, req.user?.id);
    const datasetName = ds?.fileName || 'unknown';
    const db = sheetStore.createDashboard({ name, datasetId, datasetName, tiles, ownerId: req.user?.id });
    res.json({ dashboard: db });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', (req, res) => {
  const u = sheetStore.updateDashboard(req.params.id, req.body, req.user?.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ dashboard: u });
});

router.delete('/:id', (req, res) => {
  res.json({ deleted: sheetStore.deleteDashboard(req.params.id, req.user?.id) });
});

// GET /api/dashboards/:id/insights — auto-generate insights across all tiles (LLM-enriched if available)
router.get('/:id/insights', async (req, res) => {
  try {
    const db = sheetStore.getDashboard(req.params.id, req.user?.id);
    if (!db) return res.status(404).json({ error: 'Not found' });
    const ds = require('../utils/datasetStore').get(db.datasetId, req.user?.id);
    if (!ds) return res.json({ insights: [] });
    const { generateInsights } = require('../utils/dashboardInsights');
    const llmExplainer = require('../utils/llmInsightExplainer');

    const renderedTiles = (db.tiles || []).map(tile => {
      const sheet = sheetStore.getSheet(tile.sheetId, req.user?.id);
      if (!sheet) return { ...tile, sheet: null };
      try {
        const result = buildChartFromSheet(sheet.spec, ds);
        return { ...tile, sheet, chartSpec: result.spec, chartData: result.chartData, stackKeys: result.stackKeys };
      } catch { return { ...tile, sheet, chartData: null }; }
    });

    // Build context map for LLM enrichment
    const contextByTileId = {};
    renderedTiles.forEach(t => {
      if (!t.sheet) return;
      contextByTileId[t.id] = {
        chartTitle: t.sheet.name || 'Untitled chart',
        measure: t.sheet.spec?.columns?.[0]?.field,
        dimension: t.sheet.spec?.rows?.[0]?.field,
      };
    });

    let insights = generateInsights(renderedTiles, 5);
    if (llmExplainer.isLLMAvailable()) {
      insights = await llmExplainer.enrichInsights(insights, contextByTileId);
    }

    res.json({
      insights,
      poweredBy: llmExplainer.isLLMAvailable() ? 'llm' : 'heuristic',
    });
  } catch (err) {
    console.error('[insights] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/dashboards/auto-generate/:datasetId
// Build a complete dashboard from scratch: pick 4-6 chart blueprints, save
// them as sheets, return a dashboard with tiles laid out in a 12-col grid.
router.post('/auto-generate/:datasetId', async (req, res) => {
  try {
    const ds = datasetStore.get(req.params.datasetId, req.user?.id);
    if (!ds) return res.status(404).json({ error: 'Dataset not found' });

    const autoDashboard = require('../utils/autoDashboard');
    const statInsights = require('../utils/statInsights');

    const blueprints = autoDashboard.generate({ analysis: ds.analysis });
    if (!blueprints.length) {
      return res.status(400).json({ error: 'Could not auto-generate — dataset has no usable measure columns' });
    }

    // Render each blueprint, create a sheet, build a tile
    const tiles = [];
    let row = 0, col = 0;
    for (const bp of blueprints) {
      // Save the sheet
      const sheet = sheetStore.createSheet({
        name: bp.name,
        datasetId: ds.id,
        datasetName: ds.fileName,
        spec: bp.spec,
        ownerId: req.user?.id,
      });

      // Render to compute the insight (we discard the data here — the tile
      // gets re-rendered when the dashboard is loaded)
      let insight = null;
      try {
        const rendered = buildChartFromSheet(bp.spec, ds);
        // Determine the right keys to pass to the insight generator
        const dimKey = bp.spec.columns?.[0]?.name;
        const dateKey = bp.spec.columns?.find(c => c.type === 'date')?.name;
        const valueKey = bp.spec.rows?.[0]?.name;
        const colStats = ds.analysis.columns.find(c => c.name === valueKey)?.stats;
        const keys = bp.insightFocus === 'trend' ? { dateKey, valueKey }
          : bp.insightFocus === 'correlation' ? { xKey: bp.spec.columns?.[0]?.name, yKey: bp.spec.rows?.[0]?.name }
          : { dimKey, valueKey };
        insight = statInsights.forChart({
          chartData: rendered.chartData,
          focus: bp.insightFocus,
          keys,
          columnStats: colStats,
        });
      } catch (err) {
        // Skip insights on errors — the tile still gets created
      }

      // Lay out: KPIs are 1×1, others are 2×1 (two per row in a 12-col grid
      // means each tile takes 6 cols / 1 row). Adjust if KPI vs full-width.
      const w = bp.layout?.w === 1 ? 3 : 6;     // 1×1 → 3 cols, 2×1 → 6 cols
      const h = 4;                                // ~250px each
      if (col + w > 12) { col = 0; row += h; }
      tiles.push({
        id: `tile_${tiles.length}`,
        sheetId: sheet.id,
        title: bp.name,
        x: col, y: row, w, h,
        insight,                                 // attached for the UI to show
        focus: bp.insightFocus,
      });
      col += w;
    }

    const datasetTitle = ds.fileName?.replace(/\.[^.]+$/, '') || 'Dataset';
    const dashboard = sheetStore.createDashboard({
      name: `${datasetTitle} — Overview`,
      datasetId: ds.id,
      datasetName: ds.fileName,
      tiles,
      ownerId: req.user?.id,
    });

    res.json({ dashboard, tiles, blueprintCount: blueprints.length });
  } catch (err) {
    console.error('[auto-generate] error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
