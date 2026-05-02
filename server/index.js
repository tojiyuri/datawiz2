require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');

let cookieParser;
try { cookieParser = require('cookie-parser'); }
catch (err) { console.warn('[startup] cookie-parser not installed. Run npm install.'); }

const app = express();
const PORT = process.env.PORT || 8000;

// ─── Sentry MUST be initialized before anything else uses it ──────────────
const sentry = require('./middleware/sentry');
sentry.init();

// ─── Database initialization + migrations + legacy JSON import ────────────
try {
  const db = require('./db');
  db.getDb();
  const { importAll } = require('./utils/jsonImporter');
  importAll();
  try { require('./utils/datasetStore').pruneStale(); } catch (_) {}
  // Periodically clean up expired refresh tokens (run hourly)
  try {
    const refresh = require('./utils/refreshTokens');
    refresh.pruneExpired();
    setInterval(() => { try { refresh.pruneExpired(); } catch (_) {} }, 60 * 60 * 1000);
  } catch (_) {}
} catch (err) {
  console.error('[startup] FATAL: Could not initialize database.');
  console.error(err.message);
  console.error('Run `npm install` to ensure better-sqlite3 is available.');
  process.exit(1);
}

// ─── Middleware ───────────────────────────────────────────────────────────

// Trust the first reverse proxy hop in production. Without this, req.ip is
// the proxy's IP, not the user's, breaking per-user rate limiting.
// Set via env to avoid making assumptions about deployment topology in dev.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', process.env.TRUST_PROXY);   // e.g. '1' or 'loopback,linklocal,uniquelocal'
}

// Helmet with a real Content-Security-Policy (was disabled previously,
// which left the app open to XSS amplification). The policy allows our own
// origin + known fonts/images, and explicitly denies inline-script except
// for what the SPA needs to bootstrap.
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // SPA needs inline for bootstrap; tighten if you switch to nonces
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://api.anthropic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  } : false,    // disabled in dev for HMR convenience
  crossOriginEmbedderPolicy: false,
}));

// CORS — accepts a comma-separated list of allowed origins. Vercel
// generates a unique preview URL per branch + a stable production URL,
// and you may also have a custom domain. All of them belong here.
// Example: CLIENT_URL=https://datawiz.vercel.app,https://datawiz-git-main.vercel.app
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
}));

// Use pino-http if available, else morgan
let httpLogger = null;
try {
  const pinoHttp = require('pino-http');
  httpLogger = pinoHttp({
    level: process.env.LOG_LEVEL || 'info',
    redact: ['req.headers.authorization', 'req.headers.cookie'],
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, ip: req.socket?.remoteAddress }),
      res: (res) => ({ status: res.statusCode }),
    },
  });
  app.use(httpLogger);
} catch (_) {
  app.use(morgan('dev'));
}

// 10MB body limit — file uploads go through multer, not express.json.
// The previous 500MB limit was a DoS amplifier (one POST = 500MB of mem).
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
if (cookieParser) app.use(cookieParser());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 500 }));

// Optional auth on all routes — populates req.user when a token is present
const { optionalAuth, requireAuth } = require('./middleware/auth');
app.use('/api/', optionalAuth);

// Augment Sentry scope with user info if present
app.use('/api/', (req, res, next) => {
  if (req.user) sentry.attachUser(req);
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────
// Public routes (no auth required)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/oauth', require('./routes/oauth'));

// Health/status (public for uptime monitors)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '6.7.0',
    db: 'sqlite',
    sentry: sentry.isEnabled(),
    auth: true,
    timestamp: new Date().toISOString(),
  });
});
app.get('/api/ready', (req, res) => {
  try {
    require('./db').getDb().prepare('SELECT 1').get();
    res.json({ ready: true });
  } catch (err) {
    res.status(503).json({ ready: false, error: err.message });
  }
});

// Protected API routes
app.use('/api/upload', requireAuth, require('./routes/upload'));
app.use('/api/analysis', requireAuth, require('./routes/analysis'));
app.use('/api/nlp', requireAuth, require('./routes/nlp'));
app.use('/api/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/api/cleaning', requireAuth, require('./routes/cleaning'));
app.use('/api/learning', requireAuth, require('./routes/learning'));
app.use('/api/create', requireAuth, require('./routes/datasetCreate'));
app.use('/api/sheets', requireAuth, require('./routes/sheets'));
app.use('/api/dashboards', requireAuth, require('./routes/dashboards'));
app.use('/api/connections', requireAuth, require('./routes/connections'));
app.use('/api/auto', requireAuth, require('./routes/auto'));
app.use('/api/annotations', requireAuth, require('./routes/annotations'));
app.use('/api/reports', requireAuth, require('./routes/reports'));

// Start the scheduled report dispatcher (only outside test mode)
if (process.env.NODE_ENV !== 'test' && !process.env.DATAWIZ_DISABLE_SCHEDULER) {
  try {
    require('./utils/reportScheduler').start();
  } catch (err) {
    console.warn('[startup] scheduler failed to start:', err.message);
  }
}
app.use('/api/share', require('./routes/sharing'));   // share routes have their own auth

// Admin: audit log query (admin-only)
const { requireAdmin } = require('./middleware/auth');
app.get('/api/admin/audit', requireAuth, requireAdmin, (req, res) => {
  try {
    const audit = require('./utils/audit');
    const { userId, action, since, limit } = req.query;
    res.json({ events: audit.query({ userId, action, since, limit: parseInt(limit) || 100 }) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../client/dist/index.html')));
}

// Sentry error handler must come BEFORE other error middleware
sentry.init(app); // wire up the express error handler

// Final error handler
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// Only start the listener when run as a script (not when required by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  🧙 Data Wiz v6.21 → http://localhost:${PORT}`);
    console.log(`     Deploy-ready · Vercel + Render · split-host CORS\n`);
  });
}

module.exports = app;
