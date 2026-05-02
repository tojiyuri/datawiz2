/**
 * Scheduled reports store.
 *
 * Reports schedule a dashboard to be emailed on a recurrence. The actual
 * sending is done by the scheduler module — this store is just CRUD.
 *
 * Scope:
 *   - One owner per report (the user who created it).
 *   - The dashboard must belong to (or be shared with) the owner.
 *   - When a report is sent, recipients get an email with key numbers + a
 *     link to the live dashboard. We do NOT render chart images server-side
 *     because that requires headless Chromium — a deployment burden that's
 *     out of scope for this iteration. The link-with-summary approach
 *     matches what most teams actually want anyway.
 */

const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const VALID_FREQUENCIES = ['daily', 'weekly', 'monday', 'first_of_month'];
const VALID_FORMATS = ['link', 'png', 'pdf'];   // 'link' = summary email, no rendering

function rowToReport(r) {
  if (!r) return null;
  return {
    id: r.id,
    ownerId: r.owner_id,
    dashboardId: r.dashboard_id,
    name: r.name,
    recipients: JSON.parse(r.recipients || '[]'),
    frequency: r.frequency,
    hourUtc: r.hour_utc,
    format: r.format,
    enabled: !!r.enabled,
    lastSentAt: r.last_sent_at,
    lastStatus: r.last_status,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function validate({ recipients, frequency, hourUtc, format }) {
  if (!Array.isArray(recipients) || !recipients.length) {
    throw new Error('At least one recipient email is required');
  }
  if (recipients.length > 50) throw new Error('Maximum 50 recipients per report');
  for (const e of recipients) {
    if (typeof e !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      throw new Error(`Invalid email: ${e}`);
    }
  }
  if (!VALID_FREQUENCIES.includes(frequency)) {
    throw new Error(`frequency must be one of: ${VALID_FREQUENCIES.join(', ')}`);
  }
  if (hourUtc != null && (hourUtc < 0 || hourUtc > 23)) {
    throw new Error('hourUtc must be 0-23');
  }
  if (format && !VALID_FORMATS.includes(format)) {
    throw new Error(`format must be one of: ${VALID_FORMATS.join(', ')}`);
  }
}

function listForOwner(ownerId) {
  if (!ownerId) return [];
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM scheduled_reports WHERE owner_id = ? ORDER BY created_at DESC'
  ).all(ownerId);
  return rows.map(rowToReport);
}

function get(id, ownerId) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM scheduled_reports WHERE id = ?').get(id);
  if (!row) return null;
  if (ownerId !== undefined && row.owner_id !== ownerId) return null;
  return rowToReport(row);
}

function create({ ownerId, dashboardId, name, recipients, frequency, hourUtc = 8, format = 'link' }) {
  if (!ownerId) throw new Error('ownerId required');
  if (!dashboardId) throw new Error('dashboardId required');
  if (!name) throw new Error('name required');
  validate({ recipients, frequency, hourUtc, format });

  // Verify the dashboard exists and is owned by the user
  // (we use sheetStore here because dashboards live there)
  const sheetStore = require('./sheetStore');
  const dash = sheetStore.getDashboard(dashboardId, ownerId);
  if (!dash) throw new Error('Dashboard not found or not accessible');

  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO scheduled_reports
      (id, owner_id, dashboard_id, name, recipients, frequency, hour_utc, format, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, ownerId, dashboardId, name, JSON.stringify(recipients), frequency, hourUtc, format, now, now);

  return get(id, ownerId);
}

function update(id, ownerId, patch) {
  const existing = get(id, ownerId);
  if (!existing) {
    const err = new Error('Report not found');
    err.status = 404;
    throw err;
  }

  const merged = { ...existing, ...patch };
  validate({
    recipients: merged.recipients,
    frequency: merged.frequency,
    hourUtc: merged.hourUtc,
    format: merged.format,
  });

  const db = getDb();
  const now = new Date().toISOString();
  const sets = [];
  const params = { id };
  if (patch.name !== undefined)       { sets.push('name = @name'); params.name = patch.name; }
  if (patch.recipients !== undefined) { sets.push('recipients = @recipients'); params.recipients = JSON.stringify(patch.recipients); }
  if (patch.frequency !== undefined)  { sets.push('frequency = @frequency'); params.frequency = patch.frequency; }
  if (patch.hourUtc !== undefined)    { sets.push('hour_utc = @hourUtc'); params.hourUtc = patch.hourUtc; }
  if (patch.format !== undefined)     { sets.push('format = @format'); params.format = patch.format; }
  if (patch.enabled !== undefined)    { sets.push('enabled = @enabled'); params.enabled = patch.enabled ? 1 : 0; }
  if (!sets.length) return existing;
  sets.push('updated_at = @now');
  params.now = now;

  db.prepare(`UPDATE scheduled_reports SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return get(id, ownerId);
}

function remove(id, ownerId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM scheduled_reports WHERE id = ? AND owner_id = ?').run(id, ownerId);
  return result.changes > 0;
}

/**
 * Mark a send result. Used by the scheduler after attempting delivery.
 */
function markSent(id, ok, error) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE scheduled_reports SET last_sent_at = ?, last_status = ?, last_error = ?
    WHERE id = ?
  `).run(now, ok ? 'ok' : 'error', error || null, id);
}

/**
 * Find reports that are DUE to send right now. "Due" means:
 *   - enabled = 1
 *   - frequency matches (e.g., 'daily' is always candidate; 'weekly' only on
 *     monday; 'monday' only on monday; 'first_of_month' only on day 1)
 *   - current UTC hour matches hour_utc
 *   - last_sent_at is null OR is on a different day than now (UTC)
 *
 * Returns the rows so the scheduler can iterate.
 */
function findDue(now = new Date()) {
  const db = getDb();
  const all = db.prepare('SELECT * FROM scheduled_reports WHERE enabled = 1').all();
  const dayOfWeek = now.getUTCDay();    // 0 = Sunday, 1 = Monday, ...
  const dayOfMonth = now.getUTCDate();
  const hour = now.getUTCHours();
  const today = now.toISOString().slice(0, 10);

  return all
    .map(rowToReport)
    .filter(r => {
      if (r.hourUtc !== hour) return false;
      // Frequency window
      if (r.frequency === 'weekly' || r.frequency === 'monday') {
        if (dayOfWeek !== 1) return false;
      }
      if (r.frequency === 'first_of_month' && dayOfMonth !== 1) return false;
      // De-dup: don't send twice on the same day
      if (r.lastSentAt && r.lastSentAt.slice(0, 10) === today) return false;
      return true;
    });
}

module.exports = {
  listForOwner, get, create, update, remove,
  markSent, findDue,
  VALID_FREQUENCIES, VALID_FORMATS,
};
