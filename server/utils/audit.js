/**
 * Audit log
 *
 * Records security-relevant events: logins, password changes, sheet/dashboard
 * mutations, sharing actions, OAuth links, etc. The log is append-only;
 * deletions are also recorded (so deletion of audit logs is itself auditable).
 *
 * Common action names:
 *   auth.login, auth.login.failed, auth.logout, auth.signup
 *   auth.password.changed, auth.password.reset.requested, auth.password.reset.completed
 *   auth.2fa.enabled, auth.2fa.disabled, auth.2fa.verified
 *   sheet.create, sheet.update, sheet.delete, sheet.share, sheet.unshare
 *   dashboard.create, dashboard.update, dashboard.delete
 *   dataset.upload, dataset.delete
 *   oauth.linked, oauth.unlinked
 */

const { getDb } = require('../db');

function log(event) {
  const {
    userId,
    userEmail,
    action,
    resourceId,
    resourceType,
    ip,
    userAgent,
    metadata,
  } = event;

  if (!action) return;

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO audit_log (user_id, user_email, action, resource_id, resource_type, ip, user_agent, metadata, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId || null,
      userEmail || null,
      action,
      resourceId || null,
      resourceType || null,
      ip || null,
      userAgent || null,
      metadata ? JSON.stringify(metadata) : null,
      new Date().toISOString()
    );
  } catch (err) {
    // Audit log failures should NEVER break the main operation. Just log.
    console.error('[audit] failed to record event:', err.message);
  }
}

/**
 * Record an event from an Express request. Convenience wrapper.
 */
function logFromReq(req, action, extras = {}) {
  log({
    userId: req.user?.id,
    userEmail: req.user?.email,
    action,
    ip: req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent'],
    ...extras,
  });
}

/**
 * Query the audit log. Admin-only feature.
 */
function query({ userId, action, since, limit = 100 } = {}) {
  const db = getDb();
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (action) { where.push('action LIKE ?'); params.push(action.includes('%') ? action : action + '%'); }
  if (since)  { where.push('ts >= ?'); params.push(since); }
  let sql = 'SELECT * FROM audit_log';
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY ts DESC LIMIT ?';
  params.push(limit);
  return db.prepare(sql).all(...params).map(r => ({
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    action: r.action,
    resourceId: r.resource_id,
    resourceType: r.resource_type,
    ip: r.ip,
    userAgent: r.user_agent,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    ts: r.ts,
  }));
}

module.exports = { log, logFromReq, query };
