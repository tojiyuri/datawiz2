/**
 * Routes for data sources beyond CSV/Excel:
 *   - POST /api/connections/sql/test       Test a SQL connection
 *   - POST /api/connections/sql/import     Run query, import as dataset
 *   - POST /api/connections/api/test       Test a REST API endpoint
 *   - POST /api/connections/api/import     Pull from API, import as dataset
 *   - POST /api/connections/union          Combine N datasets row-wise
 *   - POST /api/connections/join           Join 2 datasets on a key
 *   - GET  /api/connections/capabilities   What drivers are installed
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const sqlConnector = require('../utils/sqlConnector');
const apiConnector = require('../utils/apiConnector');
const datasetOps = require('../utils/datasetOperations');
const datasetStore = require('../utils/datasetStore');
const DataProcessor = require('../utils/dataProcessor');

// ─── SQL ─────────────────────────────────────────────────────────────────────

router.post('/sql/test', async (req, res) => {
  try {
    const result = await sqlConnector.testConnection(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/sql/import', async (req, res) => {
  try {
    const { connection, query, name } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

    const t0 = Date.now();
    const { rows, columns } = await sqlConnector.runQuery(connection, query);
    const queryMs = Date.now() - t0;

    if (!rows.length) {
      return res.status(400).json({ error: 'Query returned 0 rows.' });
    }

    const t1 = Date.now();
    const analysis = DataProcessor.analyzeDataset(rows);
    const id = uuidv4();
    const fileName = name || `sql_${connection.type}_${connection.database || 'query'}.json`;

    datasetStore.set(id, {
      id, ownerId: req.user?.id, fileName, fileSize: 0,
      data: rows, analysis,
      uploadedAt: new Date().toISOString(),
      source: { type: 'sql', dbType: connection.type, queryMs, originalQuery: query },
    });

    res.json({
      datasetId: id, fileName,
      rowCount: rows.length, columnCount: columns.length, analysis,
      queryMs, analysisMs: Date.now() - t1,
    });
  } catch (err) {
    console.error('[SQL import] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── REST API ────────────────────────────────────────────────────────────────

router.post('/api/test', async (req, res) => {
  try {
    const result = await apiConnector.testEndpoint(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/api/import', async (req, res) => {
  try {
    const { config, name } = req.body;
    if (!config?.url) return res.status(400).json({ error: 'config.url is required' });

    const t0 = Date.now();
    const { rows, columns, pagesFetched, capped } = await apiConnector.fetchData(config);
    const fetchMs = Date.now() - t0;

    if (!rows.length) {
      return res.status(400).json({ error: 'API returned 0 rows. Check the jsonPath if the data is nested.' });
    }

    const analysis = DataProcessor.analyzeDataset(rows);
    const id = uuidv4();

    let host = 'api';
    try { host = new URL(config.url).hostname; } catch (_) {}
    const fileName = name || `${host}_data.json`;

    datasetStore.set(id, {
      id, ownerId: req.user?.id, fileName, fileSize: 0,
      data: rows, analysis,
      uploadedAt: new Date().toISOString(),
      source: { type: 'api', url: config.url, fetchMs, pagesFetched, capped },
    });

    res.json({
      datasetId: id, fileName,
      rowCount: rows.length, columnCount: columns.length, analysis,
      pagesFetched, capped, fetchMs,
    });
  } catch (err) {
    console.error('[API import] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── UNION (append) ──────────────────────────────────────────────────────────

router.post('/union', (req, res) => {
  try {
    const { datasetIds, mode = 'union', name } = req.body;
    if (!Array.isArray(datasetIds) || datasetIds.length < 2) {
      return res.status(400).json({ error: 'Provide at least 2 datasetIds.' });
    }
    const datasets = datasetIds.map((id) => {
      const ds = datasetStore.get(id, req.user?.id);
      if (!ds) throw new Error(`Dataset ${id} not found.`);
      return ds;
    });

    const { rows, columns, sourceCount } = datasetOps.unionDatasets(datasets, mode);

    const analysis = DataProcessor.analyzeDataset(rows);
    const id = uuidv4();
    const fileName = name || `union_${sourceCount}_datasets.json`;

    datasetStore.set(id, {
      id, ownerId: req.user?.id, fileName, fileSize: 0,
      data: rows, analysis,
      uploadedAt: new Date().toISOString(),
      source: { type: 'union', sourceIds: datasetIds, mode },
    });

    res.json({
      datasetId: id, fileName,
      rowCount: rows.length, columnCount: columns.length, analysis,
    });
  } catch (err) {
    console.error('[Union] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── JOIN ────────────────────────────────────────────────────────────────────

router.post('/join', (req, res) => {
  try {
    const { leftDatasetId, rightDatasetId, leftKey, rightKey, type = 'inner', name } = req.body;
    if (!leftDatasetId || !rightDatasetId) {
      return res.status(400).json({ error: 'leftDatasetId and rightDatasetId are required.' });
    }
    const left = datasetStore.get(leftDatasetId, req.user?.id);
    const right = datasetStore.get(rightDatasetId, req.user?.id);
    if (!left) return res.status(404).json({ error: 'Left dataset not found.' });
    if (!right) return res.status(404).json({ error: 'Right dataset not found.' });

    const { rows, columns, outputRowCount } = datasetOps.joinDatasets(left, right, {
      leftKey, rightKey, type,
    });

    if (!rows.length) {
      return res.status(400).json({ error: 'Join produced 0 rows. Check that the keys match.' });
    }

    const analysis = DataProcessor.analyzeDataset(rows);
    const id = uuidv4();
    const fileName = name || `${left.fileName}_${type}_join_${right.fileName}`.replace(/\.[^.]+/g, '');

    datasetStore.set(id, {
      id, ownerId: req.user?.id, fileName, fileSize: 0,
      data: rows, analysis,
      uploadedAt: new Date().toISOString(),
      source: { type: 'join', leftDatasetId, rightDatasetId, leftKey, rightKey, joinType: type },
    });

    res.json({
      datasetId: id, fileName,
      rowCount: outputRowCount, columnCount: columns.length, analysis,
    });
  } catch (err) {
    console.error('[Join] error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── CAPABILITIES ────────────────────────────────────────────────────────────

router.get('/capabilities', (req, res) => {
  const tryRequire = (mod) => { try { require(mod); return true; } catch { return false; } };
  res.json({
    sql: {
      postgres: tryRequire('pg'),
      mysql: tryRequire('mysql2/promise'),
      sqlite: tryRequire('better-sqlite3'),
    },
    api: tryRequire('axios'),
    fileFormats: ['.csv', '.tsv', '.json', '.jsonl', '.ndjson', '.xlsx', '.xls'],
    operations: ['union', 'join'],
    notSupported: {
      bigquery: 'Use BigQuery export → CSV/JSON, then upload here.',
      snowflake: 'Use Snowflake unload → S3 → download → upload here.',
      cloudStorage: 'Download files locally first, then upload.',
      streaming: 'Streaming sources (Kafka, Kinesis) need infrastructure beyond a college project. Not supported.',
      liveConnections: 'Data Wiz uses the EXTRACT model — query once, work with imported data. Live re-querying on chart interaction is not supported.',
      rowLevelSecurity: 'Requires a user/auth system. Not yet implemented.',
    },
  });
});

module.exports = router;
