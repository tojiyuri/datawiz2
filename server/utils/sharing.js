/**
 * Sharing system.
 *
 * Two modes:
 *   1. User-to-user permissions: grant another registered user view/edit access
 *      to a sheet or dashboard.
 *   2. Public share links: anyone with the link can view (no account needed).
 *      Tokens are hashed in DB; raw tokens are only shown once at creation.
 *
 * The check function `canAccess` is the single source of truth — store layer
 * uses it instead of hard-coded owner_id checks.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ─── USER-TO-USER PERMISSIONS ────────────────────────────────────────────────

/**
 * Grant another user access to a sheet/dashboard. Resource must be owned by grantedBy.
 */
function grantPermission({ resourceType, resourceId, userId, role = 'view', grantedBy }) {
  if (!['sheet', 'dashboard'].includes(resourceType)) throw new Error('Invalid resourceType');
  if (!['view', 'edit'].includes(role)) throw new Error('Invalid role');
  if (!resourceId || !userId || !grantedBy) throw new Error('Missing required fields');

  const db = getDb();
  // Verify grantedBy actually owns the resource
  const ownerTable = resourceType === 'sheet' ? 'sheets' : 'dashboards';
  const owner = db.prepare(`SELECT owner_id FROM ${ownerTable} WHERE id = ?`).get(resourceId);
  if (!owner) throw new Error(`${resourceType} not found`);
  if (owner.owner_id && owner.owner_id !== grantedBy) {
    throw new Error('Only the owner can share this resource');
  }
  if (userId === grantedBy) throw new Error("You already own this");

  const permTable = resourceType === 'sheet' ? 'sheet_permissions' : 'dashboard_permissions';
  const idCol = resourceType === 'sheet' ? 'sheet_id' : 'dashboard_id';

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO ${permTable} (${idCol}, user_id, role, granted_by, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (${idCol}, user_id) DO UPDATE SET role = excluded.role, granted_by = excluded.granted_by
  `).run(resourceId, userId, role, grantedBy, now);

  return true;
}

function revokePermission({ resourceType, resourceId, userId, revokedBy }) {
  if (!['sheet', 'dashboard'].includes(resourceType)) throw new Error('Invalid resourceType');
  const db = getDb();

  const ownerTable = resourceType === 'sheet' ? 'sheets' : 'dashboards';
  const owner = db.prepare(`SELECT owner_id FROM ${ownerTable} WHERE id = ?`).get(resourceId);
  if (!owner) return false;
  if (owner.owner_id && owner.owner_id !== revokedBy && userId !== revokedBy) {
    // Allow self-removal: user can remove their own access
    throw new Error('Only the owner can revoke this');
  }

  const permTable = resourceType === 'sheet' ? 'sheet_permissions' : 'dashboard_permissions';
  const idCol = resourceType === 'sheet' ? 'sheet_id' : 'dashboard_id';
  return db.prepare(`DELETE FROM ${permTable} WHERE ${idCol} = ? AND user_id = ?`)
    .run(resourceId, userId).changes > 0;
}

function listPermissions({ resourceType, resourceId }) {
  const db = getDb();
  const permTable = resourceType === 'sheet' ? 'sheet_permissions' : 'dashboard_permissions';
  const idCol = resourceType === 'sheet' ? 'sheet_id' : 'dashboard_id';
  return db.prepare(`
    SELECT p.id, p.user_id, p.role, p.created_at, u.email, u.name
    FROM ${permTable} p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.${idCol} = ?
    ORDER BY p.created_at ASC
  `).all(resourceId).map(r => ({
    id: r.id,
    userId: r.user_id,
    role: r.role,
    email: r.email,
    name: r.name,
    createdAt: r.created_at,
  }));
}

// ─── ACCESS CHECK ────────────────────────────────────────────────────────────

/**
 * Returns 'owner' | 'edit' | 'view' | null based on user's relationship to the resource.
 */
function canAccess({ resourceType, resourceId, userId }) {
  const db = getDb();
  const table = resourceType === 'sheet' ? 'sheets' : 'dashboards';
  const row = db.prepare(`SELECT owner_id FROM ${table} WHERE id = ?`).get(resourceId);
  if (!row) return null;

  // Legacy NULL owner_id = treat as owned by anyone authed (pre-auth data)
  if (!row.owner_id || row.owner_id === userId) return 'owner';

  const permTable = resourceType === 'sheet' ? 'sheet_permissions' : 'dashboard_permissions';
  const idCol = resourceType === 'sheet' ? 'sheet_id' : 'dashboard_id';
  const perm = db.prepare(`SELECT role FROM ${permTable} WHERE ${idCol} = ? AND user_id = ?`)
    .get(resourceId, userId);
  return perm ? perm.role : null;
}

/**
 * List sheets shared WITH the user (where they're not the owner).
 */
function listSharedWithMe(userId) {
  const db = getDb();
  const sheets = db.prepare(`
    SELECT s.*, p.role as shared_role, p.created_at as shared_at, u.email as owner_email
    FROM sheet_permissions p
    JOIN sheets s ON s.id = p.sheet_id
    LEFT JOIN users u ON u.id = s.owner_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);

  const dashboards = db.prepare(`
    SELECT d.*, p.role as shared_role, p.created_at as shared_at, u.email as owner_email
    FROM dashboard_permissions p
    JOIN dashboards d ON d.id = p.dashboard_id
    LEFT JOIN users u ON u.id = d.owner_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(userId);

  return {
    sheets: sheets.map(s => ({
      id: s.id, name: s.name, datasetId: s.dataset_id,
      role: s.shared_role, sharedAt: s.shared_at, ownerEmail: s.owner_email,
    })),
    dashboards: dashboards.map(d => ({
      id: d.id, name: d.name, datasetId: d.dataset_id,
      role: d.shared_role, sharedAt: d.shared_at, ownerEmail: d.owner_email,
    })),
  };
}

// ─── PUBLIC SHARE LINKS ──────────────────────────────────────────────────────

/**
 * Create a public share link. Returns the raw token (visible once).
 */
function createShareLink({ resourceType, resourceId, createdBy, expiresAt = null }) {
  if (!['sheet', 'dashboard'].includes(resourceType)) throw new Error('Invalid resourceType');
  const db = getDb();

  // Verify ownership
  const table = resourceType === 'sheet' ? 'sheets' : 'dashboards';
  const owner = db.prepare(`SELECT owner_id FROM ${table} WHERE id = ?`).get(resourceId);
  if (!owner) throw new Error(`${resourceType} not found`);
  if (owner.owner_id && owner.owner_id !== createdBy) {
    throw new Error('Only the owner can create share links');
  }

  const id = 'lnk_' + uuidv4();
  const token = crypto.randomBytes(24).toString('base64url');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO share_links (id, resource_type, resource_id, token_hash, created_by, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, resourceType, resourceId, sha256(token), createdBy, expiresAt, now);

  return { id, token, expiresAt };
}

/**
 * Look up a share link by raw token. Returns null if invalid/expired/revoked.
 */
function findShareLink(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM share_links WHERE token_hash = ?').get(sha256(token));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null;
  return row;
}

function revokeShareLink(linkId, userId) {
  const db = getDb();
  return db.prepare(`
    UPDATE share_links SET revoked_at = ? WHERE id = ? AND created_by = ? AND revoked_at IS NULL
  `).run(new Date().toISOString(), linkId, userId).changes > 0;
}

function listShareLinks({ resourceType, resourceId }) {
  const db = getDb();
  return db.prepare(`
    SELECT id, expires_at, revoked_at, created_at
    FROM share_links
    WHERE resource_type = ? AND resource_id = ? AND revoked_at IS NULL
    ORDER BY created_at DESC
  `).all(resourceType, resourceId);
}

module.exports = {
  grantPermission, revokePermission, listPermissions,
  canAccess, listSharedWithMe,
  createShareLink, findShareLink, revokeShareLink, listShareLinks,
};
