/**
 * Annotations store.
 *
 * An annotation is a note attached to a specific data point on a chart.
 * Coordinates are in DATA SPACE (the actual values), not pixel space, so
 * annotations survive chart resizes and re-renders.
 *
 * Visibility model: an annotation is visible to anyone who can see the
 * sheet it belongs to. So for a private sheet, only the owner sees their
 * annotations. For a shared sheet, everyone with permission sees all
 * annotations (regardless of who created each one — annotations are
 * collaborative). This matches Tableau / Hex behavior.
 *
 * Authorization is enforced by checking sheet ownership/permissions before
 * any read/write — annotations can't be accessed without sheet access.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');
const sheetStore = require('./sheetStore');

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function rowToAnnotation(r) {
  if (!r) return null;
  return {
    id: r.id,
    sheetId: r.sheet_id,
    ownerId: r.owner_id,
    xValue: r.x_value,
    yValue: r.y_value,
    seriesKey: r.series_key,
    text: r.text,
    color: r.color,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Verify the user has read access to the sheet. Throws if not.
 * Returns the sheet on success.
 */
function assertSheetReadable(sheetId, userId) {
  const sheet = sheetStore.getSheet(sheetId, userId);
  if (!sheet) {
    const err = new Error('Sheet not found or access denied');
    err.status = 404;
    throw err;
  }
  return sheet;
}

/**
 * Verify the user has write access (owner or share role 'editor'). Throws if not.
 */
function assertSheetWritable(sheetId, userId) {
  const sheet = assertSheetReadable(sheetId, userId);
  // sharedRole === 'viewer' means read-only
  if (sheet.ownerId !== userId && sheet.sharedRole === 'viewer') {
    const err = new Error('Read-only access — cannot create or modify annotations');
    err.status = 403;
    throw err;
  }
  return sheet;
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

/**
 * List all annotations for a sheet.
 * Authorization: caller must be able to read the sheet.
 */
function listForSheet(sheetId, userId) {
  assertSheetReadable(sheetId, userId);
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM annotations WHERE sheet_id = ? ORDER BY created_at ASC'
  ).all(sheetId);
  return rows.map(rowToAnnotation);
}

/**
 * Create a new annotation.
 * Authorization: caller must have write access to the sheet.
 */
function create({ sheetId, userId, xValue, yValue, seriesKey, text, color }) {
  if (!sheetId) throw new Error('sheetId is required');
  if (!text || !text.trim()) throw new Error('text is required');
  if (text.length > 1000) throw new Error('Annotation text too long (max 1000 chars)');

  assertSheetWritable(sheetId, userId);

  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO annotations (id, sheet_id, owner_id, x_value, y_value, series_key, text, color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, sheetId, userId || null,
    xValue != null ? String(xValue) : null,
    yValue != null && Number.isFinite(Number(yValue)) ? Number(yValue) : null,
    seriesKey || null,
    text.trim(),
    color || null,
    now, now
  );

  return rowToAnnotation(
    db.prepare('SELECT * FROM annotations WHERE id = ?').get(id)
  );
}

/**
 * Update an existing annotation. Only the original author can edit text;
 * anyone with write access on the sheet can edit position/color.
 *
 * (This decision is debatable — a stricter rule is "only the author
 * can edit at all." Going with the more collaborative default.)
 */
function update(id, userId, patch) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Annotation not found');
    err.status = 404;
    throw err;
  }

  // Auth check via parent sheet
  assertSheetWritable(existing.sheet_id, userId);

  // Text edits are author-only
  if (patch.text != null && existing.owner_id && existing.owner_id !== userId) {
    const err = new Error('Only the author can edit annotation text');
    err.status = 403;
    throw err;
  }
  if (patch.text != null) {
    if (!patch.text.trim()) throw new Error('text cannot be empty');
    if (patch.text.length > 1000) throw new Error('Annotation text too long');
  }

  const now = new Date().toISOString();
  const sets = [];
  const params = {};
  if (patch.text !== undefined)      { sets.push('text = @text'); params.text = patch.text.trim(); }
  if (patch.xValue !== undefined)    { sets.push('x_value = @x'); params.x = patch.xValue != null ? String(patch.xValue) : null; }
  if (patch.yValue !== undefined)    { sets.push('y_value = @y'); params.y = patch.yValue != null && Number.isFinite(Number(patch.yValue)) ? Number(patch.yValue) : null; }
  if (patch.seriesKey !== undefined) { sets.push('series_key = @sk'); params.sk = patch.seriesKey || null; }
  if (patch.color !== undefined)     { sets.push('color = @color'); params.color = patch.color || null; }
  if (!sets.length) return rowToAnnotation(existing);

  sets.push('updated_at = @now');
  params.now = now;
  params.id = id;

  db.prepare(`UPDATE annotations SET ${sets.join(', ')} WHERE id = @id`).run(params);

  return rowToAnnotation(
    db.prepare('SELECT * FROM annotations WHERE id = ?').get(id)
  );
}

/**
 * Delete an annotation.
 * Authorization: author OR sheet owner can delete.
 */
function remove(id, userId) {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id);
  if (!existing) return false;

  const sheet = assertSheetReadable(existing.sheet_id, userId);
  const isAuthor = existing.owner_id && existing.owner_id === userId;
  const isSheetOwner = sheet.ownerId === userId;
  if (!isAuthor && !isSheetOwner) {
    const err = new Error('Only the author or sheet owner can delete this annotation');
    err.status = 403;
    throw err;
  }

  const result = db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
  return result.changes > 0;
}

module.exports = { listForSheet, create, update, remove };
