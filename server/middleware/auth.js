/**
 * Auth middleware
 *
 * Three middlewares exported:
 *   - optionalAuth: populate req.user IF a valid token is present, else continue
 *   - requireAuth:  401 if no valid token
 *   - requireAdmin: 403 if user is not admin
 *
 * Tokens come from either:
 *   - httpOnly cookie 'datawiz_auth' (preferred — XSS-resistant)
 *   - Authorization: Bearer header (fallback for API clients)
 *
 * The cookie is set on login; the header is supported for programmatic use.
 */

let jwt = null;
try { jwt = require('jsonwebtoken'); }
catch (err) { /* graceful fallback below */ }

const { getUserById } = require('../utils/authStore');

const COOKIE_NAME = 'datawiz_auth';

function extractToken(req) {
  // 1. Cookie
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  // 2. Bearer header
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function verifyToken(token) {
  if (!jwt || !token) return null;
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('[auth] JWT_SECRET not set in .env');
      return null;
    }
    return jwt.verify(token, secret);
  } catch (err) {
    return null; // expired, malformed, bad signature, etc.
  }
}

function optionalAuth(req, res, next) {
  const token = extractToken(req);
  const payload = verifyToken(token);
  if (payload?.id) {
    const user = getUserById(payload.id);
    if (user) req.user = user;
  }
  next();
}

function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required.', code: 'NO_TOKEN' });
  }

  const payload = verifyToken(token);
  if (!payload?.id) {
    return res.status(401).json({ error: 'Invalid or expired token.', code: 'INVALID_TOKEN' });
  }

  const user = getUserById(payload.id);
  if (!user) {
    // User was deleted but token is still valid
    return res.status(401).json({ error: 'User no longer exists.', code: 'USER_GONE' });
  }

  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.', code: 'NOT_ADMIN' });
  }
  next();
}

/**
 * Sign a JWT for a given user. Used by the login/signup routes.
 * Optional second arg overrides the expiry (used for short-lived 2FA-pending tokens).
 */
function signToken(user, expiresIn) {
  if (!jwt) throw new Error('jsonwebtoken not installed.');
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set in .env');
  const exp = expiresIn || process.env.JWT_ACCESS_EXPIRES_IN || process.env.JWT_EXPIRES_IN || '15m';
  const payload = user.pending2fa
    ? { id: user.id, email: user.email, role: user.role, pending2fa: true }
    : { id: user.id, email: user.email, role: user.role };
  return jwt.sign(payload, secret, { expiresIn: exp });
}

const COOKIE_NAME_LOCAL = COOKIE_NAME; // alias for clarity in older code paths
const REFRESH_COOKIE_NAME = 'datawiz_refresh';

/**
 * Standard cookie config used by login/signup/logout to keep things consistent.
 *
 * In production, the client (Vercel) and API (Render) live on different
 * domains. SameSite=Strict blocks cross-site cookies entirely, so auth
 * would silently break. SameSite=None + Secure is the only legal way for
 * browsers to send cookies across registered-domain boundaries — this is
 * what every split-host deployment uses (Auth0, Stripe Dashboard, etc.).
 *
 * Same-domain deploys (everything behind one nginx) can override this by
 * setting COOKIE_SAMESITE=lax or strict in env.
 */
function cookieConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure: isProd,                       // HTTPS-only in prod (required for sameSite=none)
    sameSite,
    maxAge: 30 * 60 * 1000,               // 30 min — access tokens are short-lived now
    path: '/',
  };
}

function refreshCookieConfig() {
  const isProd = process.env.NODE_ENV === 'production';
  const sameSite = process.env.COOKIE_SAMESITE || (isProd ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure: isProd,
    sameSite,
    maxAge: 30 * 24 * 60 * 60 * 1000,     // 30 days
    path: '/api/auth',                     // only sent to /api/auth/* (refresh, logout)
  };
}

module.exports = {
  optionalAuth, requireAuth, requireAdmin,
  signToken, cookieConfig, refreshCookieConfig,
  COOKIE_NAME, REFRESH_COOKIE_NAME,
};
