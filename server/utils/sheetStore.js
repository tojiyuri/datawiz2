/**
 * SheetStore (v6.5 — SQLite-backed)
 *
 * Stores user-built sheets and dashboards in SQLite. Public API matches the
 * original JSON-file version, so routes and other callers don't need to change.
 *
 * Key differences from v6.4 and earlier:
 *  - Concurrent saves no longer corrupt state (transactions handle locking)
 *  - No more "missing fields crashed loadSheets" bugs (schema enforces it)
 *  - Foreign keys to datasets — deleting a dataset cascades to its sheets
 *  - owner_id column is populated when auth is wired (currently always NULL)
 */

const { getDb, tx } = require('../db');

const newSheetId = () => 'sh_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
const newDashboardId = () => 'db_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

// ─── helpers ─────────────────────────────────────────────────────────────────

function rowToSheet(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    spec: r.spec ? JSON.parse(r.spec) : {},
    thumbnail: r.thumbnail,
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToDashboard(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    datasetId: r.dataset_id,
    datasetName: r.dataset_name,
    tiles: r.tiles ? JSON.parse(r.tiles) : [],
    ownerId: r.owner_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ─── SHEETS ──────────────────────────────────────────────────────────────────

function listSheets(datasetId, ownerId) {
  const db = getDb();
  // Return: own sheets + sheets shared with the user + legacy NULL-owner sheets
  let sql, params;
  if (ownerId) {
    // Strict ownership: own sheets + sheets explicitly shared via permissions.
    // Removed legacy null-owner clause (was a tenant isolation leak).
    sql = `
      SELECT DISTINCT s.* FROM sheets s
      LEFT JOIN sheet_permissions p ON p.sheet_id = s.id AND p.user_id = ?
      WHERE (s.owner_id = ? OR p.user_id = ?)
    `;
    params = [ownerId, ownerId, ownerId];
    if (datasetId) { sql += ' AND s.dataset_id = ?'; params.push(datasetId); }
  } else {
    sql = 'SELECT * FROM sheets';
    params = [];
    if (datasetId) { sql += ' WHERE dataset_id = ?'; params.push(datasetId); }
  }
  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToSheet);
}

function getSheet(id, ownerId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sheets WHERE id = ?').get(id);
  if (!row) return null;
  if (!ownerId) return rowToSheet(row);

  // Strict: must be owner OR have explicit permission. Removed legacy
  // null-owner pass-through (was a tenant isolation leak).
  if (row.owner_id === ownerId) return rowToSheet(row);
  const perm = db.prepare(
    'SELECT role FROM sheet_permissions WHERE sheet_id = ? AND user_id = ?'
  ).get(id, ownerId);
  if (perm) return { ...rowToSheet(row), sharedRole: perm.role };
  return null;
}

function createSheet({ name, datasetId, datasetName, spec, thumbnail, ownerId }) {
  if (!datasetId) throw new Error('datasetId is required');
  const db = getDb();
  const id = newSheetId();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO sheets (id, owner_id, dataset_id, dataset_name, name, spec, thumbnail, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ownerId || null,
    datasetId,
    datasetName || null,
    name || 'Untitled Sheet',
    JSON.stringify(spec || {}),
    thumbnail || null,
    now,
    now
  );
  return getSheet(id);
}

function updateSheet(id, patch, ownerId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM sheets WHERE id = ?').get(id);
  if (!existing) return null;

  // Permission check: owner, legacy null-owner, or has 'edit' permission
  if (ownerId && existing.owner_id && existing.owner_id !== ownerId) {
    const perm = db.prepare(
      'SELECT role FROM sheet_permissions WHERE sheet_id = ? AND user_id = ?'
    ).get(id, ownerId);
    if (!perm || perm.role !== 'edit') return null;
  }

  // Build UPDATE dynamically based on what fields are in the patch
  const sets = [];
  const params = [];
  if (patch.name !== undefined)        { sets.push('name = ?');         params.push(patch.name); }
  if (patch.spec !== undefined)        { sets.push('spec = ?');         params.push(JSON.stringify(patch.spec)); }
  if (patch.thumbnail !== undefined)   { sets.push('thumbnail = ?');    params.push(patch.thumbnail); }
  if (patch.datasetName !== undefined) { sets.push('dataset_name = ?'); params.push(patch.datasetName); }

  if (!sets.length) return rowToSheet(existing); // nothing to update

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE sheets SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getSheet(id);
}

function deleteSheet(id, ownerId) {
  const db = getDb();
  const existing = db.prepare('SELECT owner_id FROM sheets WHERE id = ?').get(id);
  if (!existing) return false;
  // Only owners can delete (not editors)
  if (ownerId && existing.owner_id && existing.owner_id !== ownerId) return false;

  return tx(() => {
    const result = db.prepare('DELETE FROM sheets WHERE id = ?').run(id);
    // Also strip this sheet from any dashboard's tile list
    if (result.changes > 0) {
      const dbs = db.prepare('SELECT id, tiles FROM dashboards').all();
      const updateStmt = db.prepare('UPDATE dashboards SET tiles = ?, updated_at = ? WHERE id = ?');
      const now = new Date().toISOString();
      for (const r of dbs) {
        const tiles = JSON.parse(r.tiles || '[]');
        const filtered = tiles.filter(t => t.sheetId !== id);
        if (filtered.length !== tiles.length) {
          updateStmt.run(JSON.stringify(filtered), now, r.id);
        }
      }
    }
    return result.changes > 0;
  });
}

// ─── DASHBOARDS ──────────────────────────────────────────────────────────────

function listDashboards(datasetId, ownerId) {
  const db = getDb();
  let sql = 'SELECT * FROM dashboards';
  const where = [];
  const params = [];
  if (datasetId) { where.push('dataset_id = ?'); params.push(datasetId); }
  if (ownerId) { where.push('owner_id = ?'); params.push(ownerId); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY updated_at DESC';
  const rows = db.prepare(sql).all(...params);
  return rows.map(rowToDashboard);
}

function getDashboard(id, ownerId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
  if (!row) return null;
  // Strict: ownerId must match exactly. Removed legacy null-owner pass-through.
  if (ownerId !== undefined && row.owner_id !== ownerId) return null;
  return rowToDashboard(row);
}

function createDashboard({ name, datasetId, datasetName, tiles, ownerId }) {
  if (!datasetId) throw new Error('datasetId is required');
  const db = getDb();
  const id = newDashboardId();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO dashboards (id, owner_id, dataset_id, dataset_name, name, tiles, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    ownerId || null,
    datasetId,
    datasetName || null,
    name || 'Untitled Dashboard',
    JSON.stringify(tiles || []),
    now,
    now
  );
  return getDashboard(id);
}

function updateDashboard(id, patch, ownerId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM dashboards WHERE id = ?').get(id);
  if (!existing) return null;
  if (ownerId && existing.owner_id && existing.owner_id !== ownerId) return null;

  const sets = [];
  const params = [];
  if (patch.name !== undefined)        { sets.push('name = ?');         params.push(patch.name); }
  if (patch.tiles !== undefined)       { sets.push('tiles = ?');        params.push(JSON.stringify(patch.tiles)); }
  if (patch.datasetName !== undefined) { sets.push('dataset_name = ?'); params.push(patch.datasetName); }

  if (!sets.length) return rowToDashboard(existing);

  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);

  db.prepare(`UPDATE dashboards SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getDashboard(id);
}

function deleteDashboard(id, ownerId) {
  const db = getDb();
  const existing = db.prepare('SELECT owner_id FROM dashboards WHERE id = ?').get(id);
  if (!existing) return false;
  if (ownerId && existing.owner_id && existing.owner_id !== ownerId) return false;
  const result = db.prepare('DELETE FROM dashboards WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = {
  listSheets, getSheet, createSheet, updateSheet, deleteSheet,
  listDashboards, getDashboard, createDashboard, updateDashboard, deleteDashboard,
};
