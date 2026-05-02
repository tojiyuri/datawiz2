-- Data Wiz initial schema (v6.5)
-- Designed so adding auth later is purely additive.

-- ─── USERS ───────────────────────────────────────────────────────────────────
-- Scaffolded but not wired yet. Once auth is added, every other table's
-- owner_id will start being populated. Until then, owner_id stays NULL
-- and all queries treat NULL as "global" (single-tenant fallback).
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  password_hash TEXT,                  -- bcrypt hash; NULL until auth wired
  role          TEXT DEFAULT 'user',   -- 'user' | 'admin'
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_login_at TEXT
);

-- ─── DATASETS ────────────────────────────────────────────────────────────────
-- Metadata + analysis live in this table. The actual row data is stored as a
-- separate file on disk at data/datasets/{id}.json (see datasetStore for why).
CREATE TABLE IF NOT EXISTS datasets (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT,
  file_name       TEXT NOT NULL,
  file_size       INTEGER DEFAULT 0,
  row_count       INTEGER DEFAULT 0,
  column_count    INTEGER DEFAULT 0,
  source_type     TEXT DEFAULT 'upload',     -- 'upload' | 'sql' | 'api' | 'union' | 'join'
  source_metadata TEXT,                       -- JSON
  analysis        TEXT NOT NULL,              -- JSON
  data_path       TEXT,                       -- path to the row-data file
  uploaded_at     TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_datasets_owner ON datasets(owner_id);
CREATE INDEX IF NOT EXISTS idx_datasets_uploaded ON datasets(uploaded_at DESC);

-- ─── SHEETS ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sheets (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT,
  dataset_id   TEXT NOT NULL,
  dataset_name TEXT,                  -- denormalized for fast lookups when dataset is gone
  name         TEXT NOT NULL DEFAULT 'Untitled Sheet',
  spec         TEXT NOT NULL,         -- JSON
  thumbnail    TEXT,                  -- base64 PNG or NULL
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (owner_id)   REFERENCES users(id)    ON DELETE SET NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sheets_dataset ON sheets(dataset_id);
CREATE INDEX IF NOT EXISTS idx_sheets_owner ON sheets(owner_id);
CREATE INDEX IF NOT EXISTS idx_sheets_updated ON sheets(updated_at DESC);

-- ─── DASHBOARDS ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dashboards (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT,
  dataset_id   TEXT NOT NULL,
  dataset_name TEXT,
  name         TEXT NOT NULL DEFAULT 'Untitled Dashboard',
  tiles        TEXT NOT NULL,         -- JSON array of tile configs
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (owner_id)   REFERENCES users(id)    ON DELETE SET NULL,
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dashboards_dataset ON dashboards(dataset_id);
CREATE INDEX IF NOT EXISTS idx_dashboards_owner ON dashboards(owner_id);

-- ─── LEARNING ENGINE ─────────────────────────────────────────────────────────
-- Replaces learning.json. Three tables: weights, context-specific weights, history.
CREATE TABLE IF NOT EXISTS learning_weights (
  chart_type TEXT PRIMARY KEY,
  weight     REAL NOT NULL DEFAULT 1.0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learning_context_weights (
  context_key TEXT NOT NULL,
  chart_type  TEXT NOT NULL,
  weight      REAL NOT NULL DEFAULT 1.0,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (context_key, chart_type)
);

CREATE TABLE IF NOT EXISTS learning_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,         -- 'accept' | 'dismiss' | 'recommendation'
  chart_type  TEXT,
  context_key TEXT,
  ts          INTEGER NOT NULL       -- unix ms
);

CREATE INDEX IF NOT EXISTS idx_learning_history_ts ON learning_history(ts DESC);

CREATE TABLE IF NOT EXISTS learning_stats (
  key   TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);

-- Seed default learning stats
INSERT OR IGNORE INTO learning_stats (key, value) VALUES
  ('totalRecommendations', 0),
  ('totalAccepts',         0),
  ('totalDismissals',      0),
  ('totalFeedback',        0);
