/**
 * LearningEngine (v6.5 — SQLite-backed)
 *
 * Self-improving recommendation system. Tracks user feedback on chart
 * recommendations and adjusts weights over time so the system gets smarter.
 *
 * v6.5 change: replaced learning.json with three SQLite tables. Public API
 * unchanged — chartRecommender etc. don't need updates.
 *
 * Why this matters: the JSON file approach lost data on every crash and
 * had two production bugs (corrupt-shape, missing-fields). Schema
 * enforcement makes both impossible.
 */

const { getDb, tx } = require('../db');

// ─── helpers ─────────────────────────────────────────────────────────────────

function getContextKey(ctx) {
  const { numCount = 0, catCount = 0, timeCount = 0 } = ctx || {};
  const parts = [];
  if (numCount > 0)  parts.push(`num${numCount > 2 ? '3+' : numCount}`);
  if (catCount > 0)  parts.push(`cat${catCount > 2 ? '3+' : catCount}`);
  if (timeCount > 0) parts.push('time');
  return parts.join('-') || 'empty';
}

function bumpStat(key, delta = 1) {
  const db = getDb();
  db.prepare(`
    INSERT INTO learning_stats (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = value + ?
  `).run(key, delta, delta);
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Get the multiplier for a chart type given the dataset context.
 * Combines the global weight × context-specific weight.
 */
function getWeight(chartType, ctx) {
  const db = getDb();
  const ctxKey = getContextKey(ctx);

  const globalRow = db.prepare('SELECT weight FROM learning_weights WHERE chart_type = ?').get(chartType);
  const contextRow = db.prepare(
    'SELECT weight FROM learning_context_weights WHERE context_key = ? AND chart_type = ?'
  ).get(ctxKey, chartType);

  const baseW = globalRow?.weight ?? 1.0;
  const ctxW  = contextRow?.weight ?? 1.0;
  return baseW * ctxW;
}

/**
 * Record positive feedback. Boosts both global weight (small) and
 * context-specific weight (larger) for this chart type.
 */
function recordAccept(chartType, ctx) {
  if (!chartType) return;
  const db = getDb();
  const ctxKey = getContextKey(ctx);
  const now = new Date().toISOString();

  tx(() => {
    // Boost global weight (cap 1.5)
    db.prepare(`
      INSERT INTO learning_weights (chart_type, weight, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(chart_type) DO UPDATE SET
        weight = MIN(1.5, weight + 0.02),
        updated_at = excluded.updated_at
    `).run(chartType, 1.02, now);

    // Boost context weight (cap 2.0)
    db.prepare(`
      INSERT INTO learning_context_weights (context_key, chart_type, weight, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(context_key, chart_type) DO UPDATE SET
        weight = MIN(2.0, weight + 0.05),
        updated_at = excluded.updated_at
    `).run(ctxKey, chartType, 1.05, now);

    // Log to history
    db.prepare(`
      INSERT INTO learning_history (type, chart_type, context_key, ts) VALUES ('accept', ?, ?, ?)
    `).run(chartType, ctxKey, Date.now());

    bumpStat('totalAccepts');
    bumpStat('totalFeedback');
  });
}

/**
 * Record negative feedback. Reduces both weights.
 */
function recordDismiss(chartType, ctx) {
  if (!chartType) return;
  const db = getDb();
  const ctxKey = getContextKey(ctx);
  const now = new Date().toISOString();

  tx(() => {
    // Reduce global weight (floor 0.5)
    db.prepare(`
      INSERT INTO learning_weights (chart_type, weight, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(chart_type) DO UPDATE SET
        weight = MAX(0.5, weight - 0.02),
        updated_at = excluded.updated_at
    `).run(chartType, 0.98, now);

    // Reduce context weight (floor 0.4)
    db.prepare(`
      INSERT INTO learning_context_weights (context_key, chart_type, weight, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(context_key, chart_type) DO UPDATE SET
        weight = MAX(0.4, weight - 0.05),
        updated_at = excluded.updated_at
    `).run(ctxKey, chartType, 0.95, now);

    db.prepare(`
      INSERT INTO learning_history (type, chart_type, context_key, ts) VALUES ('dismiss', ?, ?, ?)
    `).run(chartType, ctxKey, Date.now());

    bumpStat('totalDismissals');
    bumpStat('totalFeedback');
  });
}

function recordRecommendation(count = 1) {
  bumpStat('totalRecommendations', count);
}

/**
 * Reset all learning state. Useful for testing or "factory reset" feature.
 */
function reset() {
  const db = getDb();
  tx(() => {
    db.prepare('DELETE FROM learning_weights').run();
    db.prepare('DELETE FROM learning_context_weights').run();
    db.prepare('DELETE FROM learning_history').run();
    db.prepare('UPDATE learning_stats SET value = 0').run();
  });
}

/**
 * Stats for the AI Brain page.
 */
function getStats() {
  const db = getDb();

  const stats = {};
  for (const row of db.prepare('SELECT key, value FROM learning_stats').all()) {
    stats[row.key] = row.value;
  }

  const topWeights = db.prepare(`
    SELECT chart_type, weight FROM learning_weights ORDER BY weight DESC LIMIT 10
  `).all().map(r => [r.chart_type, r.weight]);

  const recentFeedback = db.prepare(`
    SELECT type, chart_type, context_key, ts FROM learning_history ORDER BY ts DESC LIMIT 10
  `).all().map(r => ({
    type: r.type,
    chartType: r.chart_type,
    ctxKey: r.context_key,
    timestamp: r.ts,
  }));

  const contextsLearned = db.prepare(
    'SELECT COUNT(DISTINCT context_key) as n FROM learning_context_weights'
  ).get().n;

  const updatedRow = db.prepare(
    'SELECT updated_at FROM learning_weights ORDER BY updated_at DESC LIMIT 1'
  ).get();

  return {
    stats: {
      totalRecommendations: stats.totalRecommendations || 0,
      totalAccepts: stats.totalAccepts || 0,
      totalDismissals: stats.totalDismissals || 0,
      totalFeedback: stats.totalFeedback || 0,
    },
    topWeights,
    contextsLearned,
    recentFeedback,
    updatedAt: updatedRow?.updated_at || null,
  };
}

module.exports = { getWeight, recordAccept, recordDismiss, recordRecommendation, getContextKey, reset, getStats };
