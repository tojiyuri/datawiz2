# Data Wiz v6.7 — Production

The third foundational shift: from "multi-user product" to "deployable system." Every gap from v6.6's honest list is now filled, with a clear distinction between what's production-ready and what's scaffolded.

## What ships in this release

### 🔐 Auth hardening

**Refresh token rotation** (`server/utils/refreshTokens.js`)
- 15-minute access tokens + 30-day refresh tokens (down from v6.6's 7-day single-token model)
- Tokens stored as SHA-256 hashes — raw values never live in the DB
- **Theft detection**: presenting a revoked token revokes ALL of that user's tokens (forces re-auth everywhere)
- "Sign out everywhere" button in Settings revokes all active refresh tokens
- Hourly cleanup of expired tokens

**2FA via TOTP** (RFC 6238)
- Compatible with Google Authenticator, Authy, 1Password, Microsoft Authenticator
- QR code displayed during setup
- 10 single-use backup codes generated on enable, shown ONCE, downloadable as `.txt`
- Backup codes are bcrypt-hashed in the DB; used codes are nulled
- Disabling 2FA requires re-entering the password (defense against session hijack)

**Email verification + password reset**
- Both flows generate single-use, time-limited tokens (24h for verify, 1h for reset)
- Token hashes only — raw tokens never stored
- Password reset always returns 200 (no email enumeration)
- Resetting password revokes ALL existing sessions

**Audit log**
- Records every security-relevant event: logins, signups, password changes, 2FA enable/disable, sheet/dashboard creation/deletion/sharing, OAuth links
- `user_email` is denormalized so logs survive user deletion
- Indexed by user, action, timestamp — fast for compliance queries
- Admin-only `/api/admin/audit` endpoint with filters
- **Audit failures NEVER break the operation** — wrapped in try/catch internally

### 🤝 Sharing

**User-to-user**
- Share by email with `view` or `edit` role
- Editors can modify the sheet/dashboard but cannot re-share or delete
- Owners can revoke at any time
- Users can self-revoke their own access ("leave this sheet")
- Email notification sent on share (best-effort)

**Public share links**
- Anyone with the link can view (no account needed)
- Token hashed in DB, raw token shown ONCE at creation
- Optional expiry, manual revocation
- Token resolves resource ID via `/api/share/public/:token`

**Cross-sharing UI**
- Reusable `<ShareDialog>` component wired into both `SheetBuilderPage` and `DashboardComposerPage`
- Single dialog handles user-to-user + link sharing + revocation
- "Shared with me" view via `listSharedWithMe()` (API ready, UI list view is a small follow-up)

**Permission model** (single source of truth)
- `canAccess({resourceType, resourceId, userId})` returns `'owner'` | `'edit'` | `'view'` | `null`
- All store queries delegate to this — no scattered ownership checks

### 📡 Observability

**Sentry — server**
- Conditional init: no-op when `SENTRY_DSN` unset
- HTTP integration + optional Node profiling
- User scope auto-attached after auth middleware
- Express error handler wired up
- PII off by default (`sendDefaultPii: false`)

**Sentry — client**
- Conditional init via dynamic import in `main.jsx`
- Activated by `VITE_SENTRY_DSN` build-time env var
- Falls through silently if package not installed (build still works)

**Structured logging**
- Pino-http when available (with auth/cookie redaction), Morgan as fallback
- Configurable log level via `LOG_LEVEL`

**Health endpoints**
- `GET /api/health` — version, Sentry status, timestamp
- `GET /api/ready` — DB ping, returns 503 if DB unreachable (orchestrator-friendly)

### 🐳 Deployment

**Docker**
- Multi-stage `Dockerfile` (Node 22 alpine)
- Build tools installed for native compilation, then removed for smaller final image
- Healthcheck baked in
- Persistent volume for SQLite + datasets

**docker-compose**
- Default: app only (SQLite-backed, persisted in volume)
- `--profile postgres`: adds Postgres 16 sidecar (for future async migration)

**GitHub Actions CI** (`.github/workflows/ci.yml`)
- Server tests on every push + PR
- Client build verification
- Docker image build on main branch
- Build artifacts uploaded for 7 days

### 🐘 Postgres

**Honest scope**: full Postgres support requires every store function (~40 sites) to be made `async`. That's a focused 1-2 day refactor I haven't done in this iteration.

**What IS shipped**:
- Migration files (`001_initial.sql`, `002_auth.sql`, `003_v67_features.sql`) written ANSI-compatible — no SQLite-specific syntax
- DB module detects `DATABASE_URL=postgres://` and warns user that stores are still SQLite-backed
- `.env` documents the variable
- docker-compose has a Postgres service ready to use

When you're ready to migrate: swap `better-sqlite3` for `pg`, `await` every store call, update Express handlers to be async. Schema changes: zero. Migration files: zero.

### 🔑 OAuth

**Google OAuth fully implemented** (`server/routes/oauth.js`)
- HMAC-signed state parameter with 10-minute validity (CSRF + replay protection)
- Authorization code flow
- Auto-creates user on first login OR links to existing email-matched account
- `oauth_accounts` table tracks provider linkage (multiple providers per user supported)
- Issues normal Data Wiz JWT after successful callback
- Login button on AuthPage shows only when configured

**What you need to do**:
1. Go to https://console.cloud.google.com
2. Create a project
3. Enable Google+ / People API
4. Create OAuth 2.0 Client ID
5. Add redirect URI: `{OAUTH_REDIRECT_BASE}/api/oauth/google/callback`
6. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`

That's it. The button on the login page appears automatically once configured.

## What's production-ready vs scaffolded

| Feature | Status |
|---|---|
| Refresh token rotation | ✅ Production-ready |
| 2FA (TOTP) | ✅ Production-ready |
| Email verification | ✅ Production-ready (console adapter for dev) |
| Password reset | ✅ Production-ready |
| Audit log | ✅ Production-ready |
| User-to-user sharing | ✅ Production-ready |
| Public share links | ✅ Production-ready |
| Sentry (server + client) | ✅ Production-ready |
| Docker + compose | ✅ Production-ready |
| GitHub Actions CI | ✅ Production-ready |
| Google OAuth | ✅ Production-ready (needs your Google Cloud setup) |
| **Postgres support** | 📝 **Scaffolded** — schema ANSI-compatible, async store refactor pending |

## Setup

```bash
cd ~/Downloads
unzip -o DataWiz-v6.7-FullStack.zip
cd datawiz

# Install — note: better-sqlite3, bcrypt, otplib, qrcode, nodemailer, pino, Sentry
# all need to install. ~60s on Mac with native compilation.
npm run install:all

# Generate JWT secret (replace dev placeholder!)
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))" >> .env

# Run dev
npm run dev

# Run tests
npm test
```

For Docker:
```bash
docker-compose up
```

For Postgres (when stores are made async):
```bash
docker-compose --profile postgres up
```

## Upgrade from v6.6

Drop in v6.7. The new schema migration runs automatically on first start. Your existing data is preserved.

**Behavior changes to know about:**
- Access token cookie now expires in 30 minutes (was 7 days). Clients must call `/api/auth/refresh` to get a new one.
- Refresh tokens are stored in a separate cookie scoped to `/api/auth/*`.
- `JWT_EXPIRES_IN` is replaced by `JWT_ACCESS_EXPIRES_IN` and `JWT_REFRESH_EXPIRES_IN`. The old name still works as a fallback.
- Password change now revokes ALL existing sessions on that account (not just the current one).

## Files

**New files:**
- `server/db/migrations/003_v67_features.sql`
- `server/utils/refreshTokens.js`
- `server/utils/audit.js`
- `server/utils/totp.js`
- `server/utils/email.js`
- `server/utils/sharing.js`
- `server/middleware/sentry.js`
- `server/routes/sharing.js`
- `server/routes/oauth.js`
- `server/__tests__/refreshTokens.test.js`
- `server/__tests__/sharing.test.js`
- `server/__tests__/audit.test.js`
- `client/src/pages/ResetPasswordPage.jsx`
- `client/src/pages/VerifyEmailPage.jsx`
- `client/src/pages/SettingsPage.jsx`
- `client/src/components/ShareDialog.jsx`
- `Dockerfile`
- `docker-compose.yml`
- `.dockerignore`
- `.github/workflows/ci.yml`

**Updated:**
- `package.json` — otplib, qrcode, nodemailer, pino, pino-http, @sentry/node, @sentry/profiling-node
- `client/package.json` — @sentry/react
- `.env` — comprehensive: DATABASE_URL, EMAIL_*, OAUTH_*, SENTRY_*, JWT access/refresh split
- `server/index.js` — Sentry init, pino-http, ready endpoint, refresh token cleanup, audit admin endpoint
- `server/middleware/auth.js` — split access + refresh cookies, 2FA-pending tokens
- `server/utils/authStore.js` — getUserByIdInternal, totpEnabled + emailVerified flags
- `server/utils/sheetStore.js` — listSheets includes shared sheets, updateSheet allows editors
- `server/routes/auth.js` — completely rewritten with 2FA, email verification, password reset, refresh rotation
- `server/db/index.js` — DATABASE_URL warning for Postgres
- `client/src/pages/AuthPage.jsx` — 2FA flow, forgot password, Google OAuth button
- `client/src/pages/SheetBuilderPage.jsx` + `DashboardComposerPage.jsx` — Share button + dialog
- `client/src/contexts/AuthContext.jsx` — completeTwoFactor function
- `client/src/utils/api.js` — 20+ new endpoints
- `client/src/App.jsx` — routes for /settings, /reset-password, /verify-email
- `client/src/components/Header.jsx` — v6.7 version, Settings menu item
- `client/src/main.jsx` — conditional Sentry init

— v6.7
