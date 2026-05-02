-- v6.17 schema: annotations, decomposition tree state, scheduled reports

-- ─── ANNOTATIONS ────────────────────────────────────────────────────────────
-- Notes attached to a specific point (or area) on a chart. The (xValue, yValue)
-- are in DATA SPACE — the actual values being annotated, not pixel coordinates.
-- This means annotations survive chart resizing, layout changes, etc.

CREATE TABLE IF NOT EXISTS annotations (
  id            TEXT PRIMARY KEY,
  sheet_id      TEXT NOT NULL,
  owner_id      TEXT,                    -- who created it (null = unauth, but we shouldn't have those)
  x_value       TEXT,                    -- data-space x; stringified for category/date/numeric uniformity
  y_value       REAL,                    -- data-space y; null for area/general annotations
  series_key    TEXT,                    -- which series for multi-series charts
  text          TEXT NOT NULL,
  color         TEXT,                    -- optional override (default: amber)
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS annotations_sheet_idx ON annotations(sheet_id);
CREATE INDEX IF NOT EXISTS annotations_owner_idx ON annotations(owner_id);

-- ─── SCHEDULED REPORTS ──────────────────────────────────────────────────────
-- A scheduled email report binds a dashboard to a recurrence + recipients.
-- The reports themselves are sent by a scheduler that polls this table.

CREATE TABLE IF NOT EXISTS scheduled_reports (
  id              TEXT PRIMARY KEY,
  owner_id        TEXT NOT NULL,
  dashboard_id    TEXT NOT NULL,
  name            TEXT NOT NULL,
  recipients      TEXT NOT NULL,         -- JSON array of email strings
  frequency       TEXT NOT NULL,         -- 'daily' | 'weekly' | 'monday' | 'first_of_month'
  hour_utc        INTEGER NOT NULL DEFAULT 8,    -- 0-23, send at this UTC hour
  format          TEXT NOT NULL DEFAULT 'png',   -- 'png' | 'pdf'
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_sent_at    TEXT,
  last_status     TEXT,                  -- 'ok' | 'error' | null
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS scheduled_reports_owner_idx ON scheduled_reports(owner_id);
CREATE INDEX IF NOT EXISTS scheduled_reports_enabled_idx ON scheduled_reports(enabled);
