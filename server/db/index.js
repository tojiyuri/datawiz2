/**
 * Database connection manager + migration runner.
 *
 * Currently uses SQLite (better-sqlite3) — synchronous, zero-config, fast.
 *
 * Postgres path: setting DATABASE_URL=postgres://... will be supported in a
 * future iteration once the stores are made async. The schema files in
 * migrations/ are written to be ANSI-compatible (no SQLite-specific syntax)
 * so the migration is mechanical when the time comes.
 */

const path = require('path');
const fs = require('fs');

let Database;
try {
  Database = require('better-sqlite3');
} catch (err) {
  console.error('[DB] better-sqlite3 not installed. Run: npm install');
  console.error('[DB] Falling back to in-memory mode — data will not persist across restarts.');
  Database = null;
}

// If DATABASE_URL is a postgres URL, warn the user we don't support it yet
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres')) {
  console.warn('[DB] DATABASE_URL is a Postgres URL, but the data stores are still SQLite-backed.');
  console.warn('[DB] Postgres support requires async store migration — see RELEASE_NOTES_v6.7.md');
  console.warn('[DB] Continuing with SQLite for now.');
}

// Three modes for resolving the DB file path:
//   1. DATAWIZ_TEST_DIR (tests) — temp directory per-test
//   2. DATA_DIR (production) — Render mounts persistent disk to a custom path
//      like /var/data. Set DATA_DIR=/var/data in env to put SQLite + dataset
//      files there so they survive container restarts.
//   3. Default — server/data/ next to the source. Fine for dev, lost on
//      every redeploy on most hosts.
const DB_FILE = process.env.DATAWIZ_TEST_DIR
  ? path.join(process.env.DATAWIZ_TEST_DIR, 'datawiz.db')
  : process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, 'datawiz.db')
  : path.join(__dirname, '../data/datawiz.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let db = null;

function ensureDir() {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Open the database. Idempotent — returns the cached connection on subsequent calls.
 */
function getDb() {
  if (db) return db;
  if (!Database) {
    throw new Error('SQLite driver unavailable. Run `npm install` to install better-sqlite3.');
  }

  ensureDir();
  db = new Database(DB_FILE);

  // Performance + concurrency settings
  db.pragma('journal_mode = WAL');       // concurrent readers + one writer
  db.pragma('synchronous = NORMAL');     // good crash safety, faster than FULL
  db.pragma('foreign_keys = ON');        // enforce FKs
  db.pragma('cache_size = -64000');      // 64MB page cache
  db.pragma('temp_store = MEMORY');

  runMigrations();

  console.log('[DB] Connected to', DB_FILE);
  return db;
}

/**
 * Apply pending migrations in numerical order.
 */
function runMigrations() {
  // Bootstrap migrations table
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.warn('[DB] No migrations directory found.');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let appliedCount = 0;

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(version, new Date().toISOString());
    });

    try {
      tx();
      console.log(`[DB] Applied migration: ${version}`);
      appliedCount++;
    } catch (err) {
      console.error(`[DB] Migration ${version} failed:`, err.message);
      throw err;
    }
  }

  if (appliedCount === 0 && files.length > 0) {
    console.log(`[DB] All ${files.length} migrations already applied.`);
  }
}

/**
 * Close the connection. Useful for tests and graceful shutdown.
 */
function close() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run a function inside a transaction. Auto-rollback on throw.
 */
function tx(fn) {
  return getDb().transaction(fn)();
}

/**
 * Returns true if SQLite is available. Routes can use this to decide whether
 * to error out gracefully or fall back to JSON-file mode.
 */
function isAvailable() {
  return Database !== null;
}

module.exports = { getDb, close, tx, isAvailable };
