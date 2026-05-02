/**
 * AuthStore — User CRUD + password hashing + login attempt tracking.
 *
 * Security notes:
 *   - Passwords are bcrypt-hashed with cost factor 12 (~250ms on a laptop).
 *     Calibrated to be fast enough for UX, slow enough to defeat GPU brute force.
 *   - We NEVER return password_hash to callers.
 *   - We track login attempts for basic brute-force protection (5 fails in 15min = lockout).
 *   - Email is normalized to lowercase before storage and lookup.
 */

const { getDb, tx } = require('../db');
const { v4: uuidv4 } = require('uuid');

let bcrypt = null;
try { bcrypt = require('bcrypt'); }
catch (err) { console.warn('[Auth] bcrypt not installed. Run: npm install'); }

const BCRYPT_COST = 12;
const LOCKOUT_THRESHOLD = 5;       // failed attempts
const LOCKOUT_WINDOW_MIN = 15;     // minutes

function normEmail(e) { return (e || '').trim().toLowerCase(); }

function rowToUser(r) {
  if (!r) return null;
  // NEVER include password_hash, totp_secret, or backup codes in the user object
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role || 'user',
    emailVerified: r.email_verified === 1,
    totpEnabled: r.totp_enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastLoginAt: r.last_login_at,
  };
}

// ─── PUBLIC API ──────────────────────────────────────────────────────────────

async function createUser({ email, password, name }) {
  if (!bcrypt) throw new Error('bcrypt unavailable. Run npm install.');
  if (!email || !password) throw new Error('Email and password are required.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email format.');

  const normalizedEmail = normEmail(email);

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) throw new Error('An account with this email already exists.');

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const id = 'usr_' + uuidv4();
  const now = new Date().toISOString();

  // First user gets admin role automatically (bootstrap convenience)
  const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  const role = userCount === 0 ? 'admin' : 'user';

  db.prepare(`
    INSERT INTO users (id, email, name, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, normalizedEmail, name || null, hash, role, now, now);

  return rowToUser({ id, email: normalizedEmail, name, role, created_at: now, updated_at: now });
}

async function verifyCredentials(email, password, ip) {
  if (!bcrypt) throw new Error('bcrypt unavailable.');
  const normalizedEmail = normEmail(email);
  const db = getDb();

  // Check lockout BEFORE doing the expensive bcrypt compare
  if (isLockedOut(normalizedEmail)) {
    recordAttempt(normalizedEmail, ip, false);
    throw new Error('Too many failed attempts. Try again in 15 minutes.');
  }

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!row || !row.password_hash) {
    // Same error message whether email exists or not (prevents email enumeration)
    recordAttempt(normalizedEmail, ip, false);
    throw new Error('Invalid email or password.');
  }

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    recordAttempt(normalizedEmail, ip, false);
    throw new Error('Invalid email or password.');
  }

  // Update last_login_at
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, row.id);

  recordAttempt(normalizedEmail, ip, true);
  return rowToUser({ ...row, last_login_at: now });
}

function getUserById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return rowToUser(row);
}

/**
 * Internal: returns the raw row (including password_hash, totp_secret, etc.)
 * Only call from server-side code that needs these fields. NEVER return this
 * from a route directly.
 */
function getUserByIdInternal(id) {
  const db = getDb();
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserByEmail(email) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(email));
  return rowToUser(row);
}

async function changePassword(userId, currentPassword, newPassword) {
  if (!bcrypt) throw new Error('bcrypt unavailable.');
  if (newPassword.length < 8) throw new Error('New password must be at least 8 characters.');

  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!row) throw new Error('User not found.');

  const ok = await bcrypt.compare(currentPassword, row.password_hash);
  if (!ok) throw new Error('Current password is incorrect.');

  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(hash, now, userId);

  return true;
}

function updateProfile(userId, patch) {
  const db = getDb();
  const sets = [];
  const params = [];
  if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
  if (!sets.length) return getUserById(userId);
  sets.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getUserById(userId);
}

function listUsers() {
  const db = getDb();
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all().map(rowToUser);
}

function userCount() {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as n FROM users').get().n;
}

// ─── BRUTE-FORCE PROTECTION ──────────────────────────────────────────────────

function recordAttempt(email, ip, success) {
  const db = getDb();
  db.prepare(`
    INSERT INTO login_attempts (email, ip, success, attempted_at) VALUES (?, ?, ?, ?)
  `).run(email, ip || null, success ? 1 : 0, new Date().toISOString());
}

function isLockedOut(email) {
  const db = getDb();
  const cutoff = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as n FROM login_attempts
    WHERE email = ? AND success = 0 AND attempted_at > ?
  `).get(email, cutoff);
  return row.n >= LOCKOUT_THRESHOLD;
}

module.exports = {
  createUser,
  verifyCredentials,
  getUserById,
  getUserByIdInternal,
  getUserByEmail,
  changePassword,
  updateProfile,
  listUsers,
  userCount,
  isLockedOut,
};
