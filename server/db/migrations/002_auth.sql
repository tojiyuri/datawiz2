-- v6.6 auth additions

-- Email lookup happens on every login. Index it.
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Track failed login attempts for rate limiting / lockout (basic protection).
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  ip         TEXT,
  success    INTEGER NOT NULL,           -- 0 or 1
  attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at DESC);

-- Refresh tokens table (scaffolded — not used by initial implementation that
-- uses long-lived access tokens. Adding the table now means future migration
-- to refresh-token rotation is just code, not schema work).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,           -- random opaque ID
  user_id     TEXT NOT NULL,
  token_hash  TEXT NOT NULL,              -- sha256 of the actual token (never store raw)
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
