-- v6.7 schema additions

-- ─── 2FA ─────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN totp_backup_codes TEXT;       -- JSON array of bcrypt-hashed codes

-- ─── EMAIL VERIFICATION ──────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evt_user ON email_verification_tokens(user_id);

-- ─── PASSWORD RESET ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id);

-- ─── AUDIT LOG ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT,
  user_email   TEXT,                -- denormalized so logs survive user deletion
  action       TEXT NOT NULL,       -- 'sheet.create', 'auth.login', etc.
  resource_id  TEXT,
  resource_type TEXT,
  ip           TEXT,
  user_agent   TEXT,
  metadata     TEXT,                -- JSON
  ts           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action, ts DESC);

-- ─── SHARING ─────────────────────────────────────────────────────────────────
-- Sheet permissions: who can view/edit a sheet besides the owner.
CREATE TABLE IF NOT EXISTS sheet_permissions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sheet_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'view',   -- 'view' | 'edit'
  granted_by TEXT,                            -- user_id who granted
  created_at TEXT NOT NULL,
  UNIQUE (sheet_id, user_id),
  FOREIGN KEY (sheet_id) REFERENCES sheets(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sp_sheet ON sheet_permissions(sheet_id);
CREATE INDEX IF NOT EXISTS idx_sp_user ON sheet_permissions(user_id);

-- Same for dashboards.
CREATE TABLE IF NOT EXISTS dashboard_permissions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dashboard_id  TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'view',
  granted_by    TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (dashboard_id, user_id),
  FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_dp_dashboard ON dashboard_permissions(dashboard_id);
CREATE INDEX IF NOT EXISTS idx_dp_user ON dashboard_permissions(user_id);

-- Public share links (anyone with the link can view, no account needed).
-- The token is hashed; we never store raw tokens.
CREATE TABLE IF NOT EXISTS share_links (
  id            TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL,                -- 'sheet' | 'dashboard'
  resource_id   TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_by    TEXT NOT NULL,
  expires_at    TEXT,                          -- NULL = no expiry
  revoked_at    TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_share_resource ON share_links(resource_type, resource_id);

-- ─── OAUTH ───────────────────────────────────────────────────────────────────
-- Track which OAuth providers a user has linked. Multiple per user is fine.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,                 -- 'google', 'github', etc.
  provider_id   TEXT NOT NULL,                 -- the user's id at the provider
  email         TEXT,
  created_at    TEXT NOT NULL,
  UNIQUE (provider, provider_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_accounts(user_id);
