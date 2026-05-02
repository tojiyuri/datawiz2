/**
 * One-time migration: import legacy JSON state into SQLite.
 *
 * This runs once on first startup after upgrading to v6.5. It:
 *  1. Reads existing sheets.json, dashboards.json, learning.json (if present)
 *  2. Inserts their contents into the new SQLite tables
 *  3. Renames the JSON files to *.imported-{timestamp}.bak so they're not
 *     re-imported next start (and the user can recover them if anything went wrong)
 *
 * Safe to run multiple times — already-imported rows are skipped via
 * INSERT OR IGNORE.
 */

const fs = require('fs');
const path = require('path');
const { getDb, tx } = require('../db');

const DATA_DIR = path.join(__dirname, '../data');

function safeReadJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`[Importer] Could not parse ${file}:`, err.message);
    return null;
  }
}

function archive(file) {
  if (!fs.existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${file}.imported-${stamp}.bak`;
  try {
    fs.renameSync(file, target);
    console.log(`[Importer] Archived → ${path.basename(target)}`);
  } catch (err) {
    console.warn(`[Importer] Could not archive ${file}:`, err.message);
  }
}

function importSheets() {
  const file = path.join(DATA_DIR, 'sheets.json');
  const raw = safeReadJson(file);
  if (!raw) return 0;

  // Handle both the old shape ({ sheets: [...] }) and the bug shape ([])
  const sheets = Array.isArray(raw) ? raw : (raw.sheets || []);
  if (!sheets.length) {
    archive(file);
    return 0;
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO sheets (id, owner_id, dataset_id, dataset_name, name, spec, thumbnail, created_at, updated_at)
    VALUES (@id, NULL, @datasetId, @datasetName, @name, @spec, @thumbnail, @createdAt, @updatedAt)
  `);

  let count = 0;
  tx(() => {
    for (const s of sheets) {
      if (!s?.id || !s?.datasetId) continue;
      stmt.run({
        id: s.id,
        datasetId: s.datasetId,
        datasetName: s.datasetName || null,
        name: s.name || 'Untitled Sheet',
        spec: JSON.stringify(s.spec || {}),
        thumbnail: s.thumbnail || null,
        createdAt: s.createdAt || new Date().toISOString(),
        updatedAt: s.updatedAt || new Date().toISOString(),
      });
      count++;
    }
  });

  archive(file);
  return count;
}

function importDashboards() {
  const file = path.join(DATA_DIR, 'dashboards.json');
  const raw = safeReadJson(file);
  if (!raw) return 0;

  const dashboards = Array.isArray(raw) ? raw : (raw.dashboards || []);
  if (!dashboards.length) {
    archive(file);
    return 0;
  }

  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO dashboards (id, owner_id, dataset_id, dataset_name, name, tiles, created_at, updated_at)
    VALUES (@id, NULL, @datasetId, @datasetName, @name, @tiles, @createdAt, @updatedAt)
  `);

  let count = 0;
  tx(() => {
    for (const d of dashboards) {
      if (!d?.id || !d?.datasetId) continue;
      stmt.run({
        id: d.id,
        datasetId: d.datasetId,
        datasetName: d.datasetName || null,
        name: d.name || 'Untitled Dashboard',
        tiles: JSON.stringify(d.tiles || []),
        createdAt: d.createdAt || new Date().toISOString(),
        updatedAt: d.updatedAt || new Date().toISOString(),
      });
      count++;
    }
  });

  archive(file);
  return count;
}

function importLearning() {
  const file = path.join(DATA_DIR, 'learning.json');
  const raw = safeReadJson(file);
  if (!raw) return 0;

  const db = getDb();
  let imports = 0;

  tx(() => {
    // Global weights
    if (raw.weights && typeof raw.weights === 'object') {
      const stmt = db.prepare(`
        INSERT INTO learning_weights (chart_type, weight, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(chart_type) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at
      `);
      const now = new Date().toISOString();
      for (const [type, weight] of Object.entries(raw.weights)) {
        if (typeof weight === 'number') {
          stmt.run(type, weight, now);
          imports++;
        }
      }
    }

    // Context weights
    if (raw.contextWeights && typeof raw.contextWeights === 'object') {
      const stmt = db.prepare(`
        INSERT INTO learning_context_weights (context_key, chart_type, weight, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(context_key, chart_type) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at
      `);
      const now = new Date().toISOString();
      for (const [ctxKey, types] of Object.entries(raw.contextWeights)) {
        if (types && typeof types === 'object') {
          for (const [type, weight] of Object.entries(types)) {
            if (typeof weight === 'number') {
              stmt.run(ctxKey, type, weight, now);
              imports++;
            }
          }
        }
      }
    }

    // History (last 200)
    if (Array.isArray(raw.history)) {
      const stmt = db.prepare(`
        INSERT INTO learning_history (type, chart_type, context_key, ts) VALUES (?, ?, ?, ?)
      `);
      for (const h of raw.history.slice(0, 200)) {
        if (h?.type) {
          stmt.run(h.type, h.chartType || null, h.ctxKey || null, h.timestamp || Date.now());
        }
      }
    }

    // Stats
    if (raw.stats && typeof raw.stats === 'object') {
      const stmt = db.prepare(`
        INSERT INTO learning_stats (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `);
      for (const [k, v] of Object.entries(raw.stats)) {
        if (typeof v === 'number') stmt.run(k, v);
      }
    }
  });

  archive(file);
  return imports;
}

/**
 * Run all importers. Logs a summary.
 * Safe to call on every startup — does nothing if files have already been archived.
 */
function importAll() {
  try {
    const s = importSheets();
    const d = importDashboards();
    const l = importLearning();

    if (s + d + l > 0) {
      console.log(`[Importer] Migrated legacy JSON state: ${s} sheets, ${d} dashboards, ${l} learning entries.`);
    }
  } catch (err) {
    console.error('[Importer] Failed:', err.message);
    // Do NOT rethrow — server should still start even if import fails
  }
}

module.exports = { importAll, importSheets, importDashboards, importLearning };
