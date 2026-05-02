/**
 * Sentry initialization (server-side).
 *
 * Loads conditionally based on SENTRY_DSN env var. If unset, all functions
 * become no-ops — no error tracking, no overhead.
 *
 * Wires:
 *   - Uncaught exceptions and unhandled rejections
 *   - Express error handler middleware
 *   - Performance traces (sampled)
 */

let Sentry = null;
let initialized = false;

function init(app) {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log('[sentry] disabled (SENTRY_DSN not set)');
    return;
  }

  try {
    Sentry = require('@sentry/node');
  } catch (err) {
    console.warn('[sentry] @sentry/node not installed. Run: npm install @sentry/node');
    return;
  }

  const profilingIntegrations = [];
  try {
    const { nodeProfilingIntegration } = require('@sentry/profiling-node');
    profilingIntegrations.push(nodeProfilingIntegration());
  } catch (_) { /* profiling is optional */ }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    profilesSampleRate: 0.1,
    integrations: [
      Sentry.httpIntegration(),
      ...profilingIntegrations,
    ],
    // Don't send PII fields by default
    sendDefaultPii: false,
  });

  // Set up Express error handler — must be added AFTER all routes
  if (app && Sentry.setupExpressErrorHandler) {
    Sentry.setupExpressErrorHandler(app);
  }

  console.log('[sentry] initialized · environment:', process.env.NODE_ENV);
}

/**
 * Augment current request scope with user info. Call after auth middleware.
 */
function attachUser(req) {
  if (!Sentry || !req.user) return;
  Sentry.setUser({ id: req.user.id, email: req.user.email });
}

function captureException(err, context) {
  if (!Sentry) return;
  Sentry.captureException(err, { extra: context });
}

function captureMessage(msg, level = 'info') {
  if (!Sentry) return;
  Sentry.captureMessage(msg, level);
}

function isEnabled() {
  return Sentry !== null;
}

module.exports = { init, attachUser, captureException, captureMessage, isEnabled };
