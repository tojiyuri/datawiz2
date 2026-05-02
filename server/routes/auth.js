/**
 * Auth routes
 *
 * Account:
 *   POST   /api/auth/signup           Create account, set cookie
 *   POST   /api/auth/login            Verify credentials → returns token (or 2fa_required)
 *   POST   /api/auth/login/2fa        Complete login by submitting TOTP code
 *   POST   /api/auth/logout           Clear cookie + revoke refresh token
 *   POST   /api/auth/logout/all       Sign out everywhere — revokes all refresh tokens
 *   POST   /api/auth/refresh          Exchange refresh token for new access token
 *   GET    /api/auth/me               Current user
 *   PATCH  /api/auth/me               Update profile (name)
 *   POST   /api/auth/change-password  Change password (revokes all refresh tokens)
 *   GET    /api/auth/status           First-run signup detection
 *
 * Email verification:
 *   POST   /api/auth/verify/send      Send verification email
 *   POST   /api/auth/verify/confirm   Confirm with token from email
 *
 * Password reset:
 *   POST   /api/auth/forgot           Request reset email
 *   POST   /api/auth/reset            Set new password using reset token
 *
 * 2FA:
 *   POST   /api/auth/2fa/setup        Generate secret + QR (returns otpauth URL too)
 *   POST   /api/auth/2fa/enable       Verify first code + activate 2FA
 *   POST   /api/auth/2fa/disable      Disable 2FA (requires current password)
 *   GET    /api/auth/2fa/status       Is 2FA enabled?
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const authStore = require('../utils/authStore');
const refreshTokens = require('../utils/refreshTokens');
const audit = require('../utils/audit');
const totp = require('../utils/totp');
const email = require('../utils/email');
const { getDb, tx } = require('../db');
const {
  signToken, cookieConfig, COOKIE_NAME, REFRESH_COOKIE_NAME, refreshCookieConfig, requireAuth,
} = require('../middleware/auth');

let bcrypt = null;
try { bcrypt = require('bcrypt'); } catch (_) {}

// Tighter rate limit on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  message: { error: 'Too many auth attempts. Please wait a few minutes.' },
  standardHeaders: true, legacyHeaders: false,
});

const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  message: { error: 'Too many email requests. Please wait an hour.' },
});

// Helper: issue both tokens as cookies + return them in the body
function issueSession(res, user) {
  const accessToken = signToken(user);
  const refresh = refreshTokens.issue(user.id);
  res.cookie(COOKIE_NAME, accessToken, cookieConfig());
  res.cookie(REFRESH_COOKIE_NAME, refresh.token, refreshCookieConfig());
  return { accessToken, refreshToken: refresh.token };
}

const ip = (req) => req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;

// ─── SIGNUP ──────────────────────────────────────────────────────────────────

router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email: e, password, name } = req.body || {};
    const user = await authStore.createUser({ email: e, password, name });
    issueSession(res, user);
    audit.logFromReq(req, 'auth.signup', { resourceId: user.id, resourceType: 'user' });

    // Send verification email (best-effort, don't block signup on it)
    try { await sendVerificationEmail(user, req); } catch (err) {
      console.error('[signup] verification email failed:', err.message);
    }

    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── LOGIN ───────────────────────────────────────────────────────────────────

router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email: e, password } = req.body || {};
    if (!e || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = await authStore.verifyCredentials(e, password, ip(req));

    // If 2FA is enabled, return a partial-auth response and stop here
    if (user.totpEnabled) {
      // Issue a short-lived "pending 2FA" token so the next call can resume
      const pendingToken = signToken({ id: user.id, email: user.email, role: user.role, pending2fa: true }, '10m');
      audit.logFromReq(req, 'auth.login.2fa_required', { userId: user.id, resourceId: user.id });
      return res.json({ twoFactorRequired: true, pendingToken });
    }

    issueSession(res, user);
    audit.logFromReq(req, 'auth.login', { resourceId: user.id, resourceType: 'user' });
    res.json({ user });
  } catch (err) {
    audit.log({ action: 'auth.login.failed', userEmail: req.body?.email, ip: ip(req), userAgent: req.headers['user-agent'] });
    res.status(401).json({ error: err.message });
  }
});

router.post('/login/2fa', authLimiter, async (req, res) => {
  try {
    const { pendingToken, code, backupCode } = req.body || {};
    if (!pendingToken) return res.status(400).json({ error: 'Missing pending token' });

    let payload;
    try {
      const jwt = require('jsonwebtoken');
      payload = jwt.verify(pendingToken, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ error: 'Pending token expired. Please log in again.' });
    }
    if (!payload.pending2fa) return res.status(400).json({ error: 'Not a 2FA token' });

    const user = authStore.getUserByIdInternal(payload.id);
    if (!user || !user.totp_enabled) return res.status(400).json({ error: 'User has no 2FA enabled' });

    let ok = false;
    if (code) ok = totp.verifyCode(code, user.totp_secret);
    if (!ok && backupCode && bcrypt) {
      const codes = user.totp_backup_codes ? JSON.parse(user.totp_backup_codes) : [];
      const idx = await totp.verifyBackupCode(bcrypt, backupCode, codes);
      if (idx !== -1) {
        codes[idx] = null; // single-use
        const db = getDb();
        db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?')
          .run(JSON.stringify(codes), user.id);
        ok = true;
        audit.logFromReq(req, 'auth.2fa.backup_code_used', { userId: user.id });
      }
    }

    if (!ok) {
      audit.logFromReq(req, 'auth.login.2fa_failed', { userId: user.id });
      return res.status(401).json({ error: 'Invalid 2FA code' });
    }

    const cleanUser = authStore.getUserById(user.id);
    issueSession(res, cleanUser);
    audit.logFromReq(req, 'auth.login', { userId: user.id, resourceId: user.id, metadata: { with2FA: true } });
    res.json({ user: cleanUser });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LOGOUT ──────────────────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  const refresh = req.cookies?.[REFRESH_COOKIE_NAME];
  if (refresh) refreshTokens.revoke(refresh);
  res.clearCookie(COOKIE_NAME, { ...cookieConfig(), maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieConfig(), maxAge: 0 });
  audit.logFromReq(req, 'auth.logout');
  res.json({ ok: true });
});

router.post('/logout/all', requireAuth, (req, res) => {
  const n = refreshTokens.revokeAllForUser(req.user.id);
  res.clearCookie(COOKIE_NAME, { ...cookieConfig(), maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE_NAME, { ...refreshCookieConfig(), maxAge: 0 });
  audit.logFromReq(req, 'auth.logout.all', { metadata: { revokedCount: n } });
  res.json({ ok: true, revoked: n });
});

// ─── REFRESH ─────────────────────────────────────────────────────────────────

router.post('/refresh', (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
  if (!rawToken) return res.status(401).json({ error: 'No refresh token' });

  const result = refreshTokens.rotate(rawToken);
  if (!result) return res.status(401).json({ error: 'Invalid or expired refresh token' });
  if (result.stolen) {
    audit.logFromReq(req, 'auth.refresh.theft_detected', { metadata: { detail: 'Reused revoked token' } });
    return res.status(401).json({ error: 'Token theft detected. All sessions revoked.', code: 'TOKEN_THEFT' });
  }

  // Look up user and issue new access token
  const db = getDb();
  const userRow = db.prepare('SELECT * FROM users WHERE id = (SELECT user_id FROM refresh_tokens WHERE id = ?)').get(result.id);
  if (!userRow) return res.status(401).json({ error: 'User not found' });

  const user = { id: userRow.id, email: userRow.email, role: userRow.role };
  const accessToken = signToken(user);
  res.cookie(COOKIE_NAME, accessToken, cookieConfig());
  res.cookie(REFRESH_COOKIE_NAME, result.token, refreshCookieConfig());
  res.json({ ok: true });
});

// ─── ME ──────────────────────────────────────────────────────────────────────

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.patch('/me', requireAuth, (req, res) => {
  try {
    const { name } = req.body || {};
    const updated = authStore.updateProfile(req.user.id, { name });
    audit.logFromReq(req, 'user.profile.updated');
    res.json({ user: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── CHANGE PASSWORD ─────────────────────────────────────────────────────────

router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Both passwords are required' });
    }
    await authStore.changePassword(req.user.id, currentPassword, newPassword);
    refreshTokens.revokeAllForUser(req.user.id);
    audit.logFromReq(req, 'auth.password.changed');
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── FIRST-RUN STATUS ────────────────────────────────────────────────────────

router.get('/status', (req, res) => {
  res.json({
    needsSetup: authStore.userCount() === 0,
    userCount: authStore.userCount(),
    googleOAuthEnabled: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  });
});

// ─── EMAIL VERIFICATION ──────────────────────────────────────────────────────

async function sendVerificationEmail(user, req) {
  const db = getDb();
  // Invalidate any prior unused tokens
  db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
    .run(new Date().toISOString(), user.id);

  const id = 'evt_' + uuidv4();
  const rawToken = crypto.randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(`
    INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, user.id, refreshTokens.sha256(rawToken), expiresAt, new Date().toISOString());

  const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/verify-email?token=${rawToken}`;
  const msg = email.verifyEmailMessage({ name: user.name, link });
  await email.send({ to: user.email, ...msg });
}

router.post('/verify/send', requireAuth, emailLimiter, async (req, res) => {
  try {
    if (req.user.emailVerified) return res.json({ ok: true, alreadyVerified: true });
    await sendVerificationEmail(req.user, req);
    audit.logFromReq(req, 'auth.email.verification_sent');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify/confirm', authLimiter, async (req, res) => {
  try {
    const { token } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Missing token' });

    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM email_verification_tokens WHERE token_hash = ?
    `).get(refreshTokens.sha256(token));

    if (!row) return res.status(400).json({ error: 'Invalid token' });
    if (row.used_at) return res.status(400).json({ error: 'Token already used' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

    tx(() => {
      db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(row.user_id);
      db.prepare('UPDATE email_verification_tokens SET used_at = ? WHERE id = ?')
        .run(new Date().toISOString(), row.id);
    });

    audit.logFromReq(req, 'auth.email.verified', { userId: row.user_id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PASSWORD RESET ──────────────────────────────────────────────────────────

router.post('/forgot', emailLimiter, async (req, res) => {
  // Always returns ok regardless of whether the email exists (no enumeration)
  try {
    const { email: e } = req.body || {};
    if (!e) return res.status(400).json({ error: 'Email is required' });

    const user = authStore.getUserByEmail(e);
    if (user) {
      const db = getDb();
      const id = 'prt_' + uuidv4();
      const rawToken = crypto.randomBytes(24).toString('base64url');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
      db.prepare(`
        INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, ip, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, user.id, refreshTokens.sha256(rawToken), expiresAt, ip(req), new Date().toISOString());

      const link = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`;
      const msg = email.passwordResetMessage({ name: user.name, link });
      await email.send({ to: user.email, ...msg });

      audit.log({
        userId: user.id, userEmail: user.email,
        action: 'auth.password.reset.requested', ip: ip(req),
      });
    }
    // Always success — don't leak whether email exists
    res.json({ ok: true });
  } catch (err) {
    console.error('[forgot] error:', err.message);
    res.json({ ok: true }); // still don't leak
  }
});

router.post('/reset', authLimiter, async (req, res) => {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const db = getDb();
    const row = db.prepare(`
      SELECT * FROM password_reset_tokens WHERE token_hash = ?
    `).get(refreshTokens.sha256(token));

    if (!row) return res.status(400).json({ error: 'Invalid token' });
    if (row.used_at) return res.status(400).json({ error: 'Token already used' });
    if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Token expired' });

    if (!bcrypt) return res.status(500).json({ error: 'bcrypt unavailable' });
    const hash = await bcrypt.hash(newPassword, 12);

    tx(() => {
      const now = new Date().toISOString();
      db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, now, row.user_id);
      db.prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?').run(now, row.id);
    });

    // Revoke all existing sessions for this user
    refreshTokens.revokeAllForUser(row.user_id);

    audit.log({ userId: row.user_id, action: 'auth.password.reset.completed', ip: ip(req) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── 2FA ─────────────────────────────────────────────────────────────────────

router.get('/2fa/status', requireAuth, (req, res) => {
  const user = authStore.getUserByIdInternal(req.user.id);
  res.json({ enabled: !!user?.totp_enabled });
});

router.post('/2fa/setup', requireAuth, async (req, res) => {
  try {
    const secret = totp.generateSecret();
    const otpauthUrl = totp.buildOtpauthUrl(req.user.email, secret);
    const qrDataUrl = await totp.generateQrCode(otpauthUrl);

    // Store as PENDING — only activate after user verifies first code
    const db = getDb();
    db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = ?').run(secret, req.user.id);

    res.json({ qr: qrDataUrl, otpauth: otpauthUrl, secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/2fa/enable', requireAuth, async (req, res) => {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'Code is required' });

    const user = authStore.getUserByIdInternal(req.user.id);
    if (!user.totp_secret) return res.status(400).json({ error: 'Run 2FA setup first' });

    if (!totp.verifyCode(code, user.totp_secret)) {
      return res.status(401).json({ error: 'Invalid code' });
    }

    // Generate backup codes
    if (!bcrypt) return res.status(500).json({ error: 'bcrypt unavailable' });
    const { codes, hashes } = await totp.generateBackupCodes(bcrypt);

    const db = getDb();
    db.prepare(`
      UPDATE users SET totp_enabled = 1, totp_backup_codes = ? WHERE id = ?
    `).run(JSON.stringify(hashes), req.user.id);

    audit.logFromReq(req, 'auth.2fa.enabled');

    // Show backup codes to user ONCE — they should write them down
    res.json({ ok: true, backupCodes: codes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/2fa/disable', requireAuth, async (req, res) => {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'Current password required' });

    // Re-verify password before disabling 2FA (defense against session hijack)
    await authStore.verifyCredentials(req.user.email, password, ip(req));

    const db = getDb();
    db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?')
      .run(req.user.id);

    audit.logFromReq(req, 'auth.2fa.disabled');
    res.json({ ok: true });
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

module.exports = router;
