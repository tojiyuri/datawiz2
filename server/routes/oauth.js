/**
 * Google OAuth 2.0 sign-in.
 *
 * REQUIRES: Google Cloud Console setup. See README for steps.
 *   - Create a project at https://console.cloud.google.com
 *   - Enable "Google+ API" / "People API"
 *   - Create OAuth 2.0 Client ID with redirect URI:
 *     {OAUTH_REDIRECT_BASE}/api/oauth/google/callback
 *   - Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *
 * Flow:
 *   1. /api/oauth/google/start    → redirect to Google with state=CSRF token
 *   2. Google → /api/oauth/google/callback?code=...&state=...
 *   3. We exchange code for tokens, fetch profile, create or link user
 *   4. Issue our own JWT cookies, redirect to /
 *
 * The state parameter is signed (HMAC) and includes the timestamp to prevent
 * CSRF and replay attacks.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const audit = require('../utils/audit');
const refreshTokens = require('../utils/refreshTokens');
const { getDb } = require('../db');
const {
  signToken, cookieConfig, refreshCookieConfig, COOKIE_NAME, REFRESH_COOKIE_NAME,
} = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

let axios = null;
try { axios = require('axios'); } catch (_) {}

function isConfigured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  return `${process.env.OAUTH_REDIRECT_BASE || 'http://localhost:8000'}/api/oauth/google/callback`;
}

function signState(payload) {
  const json = JSON.stringify({ ...payload, ts: Date.now() });
  const data = Buffer.from(json).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(data).digest('hex').slice(0, 32);
  return `${data}.${sig}`;
}

function verifyState(state) {
  if (!state || !state.includes('.')) return null;
  const [data, sig] = state.split('.');
  const expected = crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(data).digest('hex').slice(0, 32);
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf-8'));
    if (Date.now() - payload.ts > 10 * 60 * 1000) return null; // 10-min validity
    return payload;
  } catch (_) { return null; }
}

router.get('/google/start', (req, res) => {
  if (!isConfigured()) {
    return res.status(501).json({
      error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.',
    });
  }
  const state = signState({ nonce: crypto.randomBytes(8).toString('hex') });
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  if (!isConfigured()) return res.status(501).send('OAuth not configured');
  if (!axios) return res.status(500).send('axios not installed');

  const { code, state, error } = req.query;
  if (error) return res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/login?error=${encodeURIComponent(error)}`);
  if (!code || !state) return res.status(400).send('Missing code or state');
  if (!verifyState(state)) return res.status(400).send('Invalid or expired state');

  try {
    // Exchange code for tokens
    const tokenRes = await axios.post('https://oauth2.googleapis.com/token', {
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    });

    // Fetch user profile
    const profile = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
    });
    const { id: providerId, email, name, verified_email } = profile.data;

    if (!email) return res.status(400).send('No email returned from Google');

    // Find or create the local user
    const db = getDb();
    const linkRow = db.prepare(
      'SELECT user_id FROM oauth_accounts WHERE provider = ? AND provider_id = ?'
    ).get('google', providerId);

    let user;
    if (linkRow) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(linkRow.user_id);
    } else {
      // No link — match by email or create new user
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
      if (!user) {
        const userId = 'usr_' + uuidv4();
        const now = new Date().toISOString();
        const userCount = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
        const role = userCount === 0 ? 'admin' : 'user';
        db.prepare(`
          INSERT INTO users (id, email, name, role, email_verified, created_at, updated_at, last_login_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(userId, email.toLowerCase(), name || null, role, verified_email ? 1 : 0, now, now, now);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
      }
      // Link the OAuth account
      db.prepare(`
        INSERT INTO oauth_accounts (user_id, provider, provider_id, email, created_at)
        VALUES (?, 'google', ?, ?, ?)
      `).run(user.id, providerId, email, new Date().toISOString());
      audit.log({ userId: user.id, action: 'oauth.linked', metadata: { provider: 'google' } });
    }

    // Issue our own session
    const accessToken = signToken({ id: user.id, email: user.email, role: user.role });
    const refresh = refreshTokens.issue(user.id);
    res.cookie(COOKIE_NAME, accessToken, cookieConfig());
    res.cookie(REFRESH_COOKIE_NAME, refresh.token, refreshCookieConfig());

    audit.log({
      userId: user.id, userEmail: user.email,
      action: 'auth.login', metadata: { via: 'google_oauth' },
    });

    res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/`);
  } catch (err) {
    console.error('[oauth/google/callback]', err.response?.data || err.message);
    res.redirect(`${process.env.CLIENT_URL || 'http://localhost:5173'}/login?error=oauth_failed`);
  }
});

module.exports = router;
