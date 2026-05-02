/**
 * Refresh token store with rotation.
 *
 * Pattern: short-lived access tokens (15 min) + long-lived refresh tokens (30 days).
 * On refresh, the old token is revoked and a new one issued. If a stolen token
 * is used after the legitimate user has refreshed, the system can detect the
 * race and revoke all of that user's tokens (token theft detection).
 *
 * Tokens are stored as sha256 hashes — the raw token never lives in the DB.
 */

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const REFRESH_TTL_DAYS = 30;

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function generateRawToken() {
  return crypto.randomBytes(48).toString('base64url');
}

/**
 * Issue a new refresh token for a user. Returns { id, token } where token
 * is the raw value to send to the client.
 */
function issue(userId, ttlDays = REFRESH_TTL_DAYS) {
  const db = getDb();
  const id = 'rt_' + uuidv4();
  const token = generateRawToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, sha256(token), expiresAt.toISOString(), now.toISOString());

  return { id, token, expiresAt };
}

/**
 * Verify a raw token and return its row. Returns null if invalid/expired/revoked.
 */
function verify(rawToken) {
  if (!rawToken) return null;
  const db = getDb();
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(sha256(rawToken));
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;
  return row;
}

/**
 * Revoke a single refresh token by raw value.
 */
function revoke(rawToken) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(now, sha256(rawToken)).changes;
}

/**
 * Revoke ALL active refresh tokens for a user. Used on:
 *   - Password change
 *   - Suspected token theft
 *   - "Sign out everywhere" button
 */
function revokeAllForUser(userId) {
  const db = getDb();
  const now = new Date().toISOString();
  return db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(now, userId).changes;
}

/**
 * Rotate: revoke the old token and issue a new one. Returns the new raw token.
 * If the old token has already been revoked but is being presented again,
 * we treat that as theft and revoke ALL tokens for the user.
 */
function rotate(rawToken) {
  if (!rawToken) return null;
  const db = getDb();
  const tokenHash = sha256(rawToken);
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash);

  if (!row) return null;

  // Theft detection: token was already revoked, but someone is presenting it again
  if (row.revoked_at) {
    revokeAllForUser(row.user_id);
    return { stolen: true };
  }

  if (new Date(row.expires_at) < new Date()) return null;

  // Atomic: revoke old + issue new
  const now = new Date().toISOString();
  db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?').run(now, row.id);
  return issue(row.user_id);
}

/**
 * Cleanup: delete tokens that expired more than 7 days ago. Call periodically.
 */
function pruneExpired() {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return db.prepare('DELETE FROM refresh_tokens WHERE expires_at < ?').run(cutoff).changes;
}

module.exports = { issue, verify, revoke, revokeAllForUser, rotate, pruneExpired, sha256 };
