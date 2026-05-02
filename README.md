# Data Wiz

AI-powered data visualization platform with multi-tenant auth, sheet/dashboard composer, and conversational chart building.

**Current version:** v6.7 "Production"

---

## Quick start

```bash
git clone <repo>
cd datawiz

# Install — server + client. ~60s with native compilation.
npm run install:all

# Generate a real JWT secret (replace the dev placeholder)
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))" >> .env

# Dev
npm run dev          # client at :5173, server at :8000
npm test             # run all tests
```

On first visit you'll be sent to `/signup` — the first account becomes admin.

---

## Stack

- **Backend:** Node.js + Express, SQLite via better-sqlite3, JWT auth (httpOnly cookies)
- **Frontend:** React 18 + Vite + Tailwind, framer-motion, recharts
- **Tests:** Vitest with `pool: 'forks'` for isolation, supertest for E2E
- **Deploy:** Docker (multi-stage), GitHub Actions CI

---

## Configuration

All configuration lives in `.env`. Required for any non-dev use:

```bash
# Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<long-random-string>
NODE_ENV=production
PORT=8000
CLIENT_URL=https://your-domain.com
```

### Email (for verification + password reset)

```bash
# Dev: just log emails to stdout — no SMTP needed
EMAIL_PROVIDER=console

# Prod: real email via SMTP (Mailgun, SendGrid, SES, etc.)
EMAIL_PROVIDER=smtp
EMAIL_FROM=Data Wiz <noreply@yourdomain.com>
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=<your-api-key>
SMTP_SECURE=false

# Disable entirely (tests, etc.)
EMAIL_PROVIDER=disabled
```

In dev, password reset links print to the server console — copy/paste them into your browser.

### Google OAuth (optional)

1. Go to https://console.cloud.google.com → New project
2. Enable the People API
3. APIs & Services → Credentials → Create OAuth 2.0 Client ID
4. Application type: Web application
5. Authorized redirect URIs: add `http://localhost:8000/api/oauth/google/callback` (dev) and your production callback URL
6. Copy Client ID + Client Secret to `.env`:

```bash
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
OAUTH_REDIRECT_BASE=http://localhost:8000   # or your prod URL
```

The "Continue with Google" button on the login page appears automatically once configured.

### Sentry (optional)

```bash
SENTRY_DSN=https://...@sentry.io/...
SENTRY_TRACES_SAMPLE_RATE=0.1
```

For client-side error tracking, set `VITE_SENTRY_DSN` at build time:

```bash
VITE_SENTRY_DSN=https://...@sentry.io/... npm run build
```

### LLM (optional)

```bash
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

Without a key, Data Wiz falls back to a built-in heuristic engine for the conversational sheet builder and AI insights.

---

## Docker

```bash
# Build + run
docker-compose up

# Build only
docker build -t datawiz .

# With Postgres sidecar (when stores are async-ready)
docker-compose --profile postgres up
```

The container exposes port 8000 and persists data in two named volumes:
- `datawiz-data` — SQLite DB + dataset files
- `datawiz-uploads` — temp upload staging

`/api/ready` is wired up as the healthcheck.

---

## Authentication

All API routes except `/api/auth/*`, `/api/oauth/*`, `/api/share/public/*`, `/api/health`, `/api/ready` require auth. The JWT lives in an httpOnly cookie (XSS-resistant, CSRF-safe with `SameSite=lax`).

**Endpoints:**

```
POST   /api/auth/signup            # First user becomes admin
POST   /api/auth/login             # Returns {twoFactorRequired, pendingToken} if 2FA
POST   /api/auth/login/2fa         # Complete 2FA login
POST   /api/auth/logout
POST   /api/auth/logout/all        # Sign out everywhere
POST   /api/auth/refresh           # Rotate refresh token
GET    /api/auth/me
PATCH  /api/auth/me
POST   /api/auth/change-password
GET    /api/auth/status            # First-run + OAuth detection

POST   /api/auth/verify/send       # Send email verification
POST   /api/auth/verify/confirm    # Confirm with token

POST   /api/auth/forgot            # Request password reset
POST   /api/auth/reset             # Set new password using reset token

GET    /api/auth/2fa/status
POST   /api/auth/2fa/setup         # Returns QR + otpauth URL
POST   /api/auth/2fa/enable        # Verify first code, returns backup codes ONCE
POST   /api/auth/2fa/disable       # Requires current password

GET    /api/oauth/google/start
GET    /api/oauth/google/callback
```

**Security defaults:**
- bcrypt cost factor 12 (~250ms hash time)
- 5 failed logins in 15min → account temporarily locked
- 20 auth attempts per IP in 15min → rate limited
- 30-min access tokens, 30-day refresh tokens with rotation
- Refresh token theft detection: reusing a revoked token revokes ALL of that user's tokens

---

## Sharing

Sheets and dashboards can be shared in two ways:

**User-to-user**
```
POST   /api/share/sheet/:id        { email, role, notify }
POST   /api/share/dashboard/:id    { email, role, notify }
GET    /api/share/sheet/:id/users
DELETE /api/share/sheet/:id/users/:userId
```

Roles: `view` (read-only) or `edit` (can modify, cannot re-share).

**Public links**
```
POST   /api/share/sheet/:id/link       Returns raw token ONCE
POST   /api/share/dashboard/:id/link
DELETE /api/share/links/:linkId        Revoke
GET    /api/share/public/:token        Resolve token to resource ID (no auth)
```

Tokens are SHA-256 hashed in DB. Optional expiration. Revocable.

**See sheets shared with me**
```
GET    /api/share/with-me
```

---

## Audit log

Every security-relevant event is logged: signups, logins, password changes, 2FA enable/disable, sheet/dashboard mutations, sharing actions, OAuth links.

```
GET /api/admin/audit?userId=&action=&since=&limit=    (admin only)
```

User email is denormalized into the log table so events survive user deletion.

---

## Tests

```bash
npm test              # one-shot, all suites
npm run test:watch    # watch mode
```

10 test files covering ~100 cases:

| Suite | Coverage |
|---|---|
| `auth.test.js` | Signup, login, lockout, password change, email normalization |
| `multitenancy.test.js` | Cross-user isolation at the store layer |
| `routes.test.js` | E2E via supertest — real Express, real auth, real cookies |
| `refreshTokens.test.js` | Rotation, theft detection, revocation |
| `sharing.test.js` | Permission grants/revokes, public links, expiry |
| `audit.test.js` | Append-only event recording, query filters |
| `datasetOperations.test.js` | All union modes, all 4 join types, 50K-row perf |
| `formulaEngine.test.js` | Parser, evaluator, calculated fields, IF/THEN/ELSE |
| `jsonImporter.test.js` | v6.5 migration robustness against corrupt files |

---

## Production checklist

Before exposing this publicly:

- [ ] Set strong `JWT_SECRET` (64+ random bytes)
- [ ] `NODE_ENV=production` (enables `secure: true` + `SameSite=strict` cookies)
- [ ] Real `EMAIL_PROVIDER=smtp` with valid credentials
- [ ] HTTPS in front (cookies are `secure: true` in production)
- [ ] `CLIENT_URL` matches your production domain
- [ ] Sentry DSN configured for both server + client
- [ ] First user signed up (becomes admin) before announcing the URL
- [ ] Volume mounts persisted (`/app/server/data` and `/app/server/uploads`)
- [ ] `OAUTH_REDIRECT_BASE` matches production URL if using Google OAuth
- [ ] Backups on the SQLite file (or migrate to Postgres before scale)

---

## Known limitations

- **SQLite only.** Postgres migrations are written ANSI-compatible, but the stores are still synchronous SQLite-backed. Async refactor pending.
- **No team/org concept yet.** Sharing is per-user. Multi-tenant orgs would need a new `organizations` table + scope changes.
- **Audit log retention is unbounded.** No automatic pruning. For high-volume deployments, add a periodic cleanup job.
- **Email templates are basic.** Customize the HTML in `server/utils/email.js` for branded emails.

---

## Project structure

```
datawiz/
├── client/                      React + Vite frontend
│   └── src/
│       ├── components/          ChartRenderer, ShareDialog, FormulaEditor, etc.
│       ├── pages/               UploadPage, SheetBuilder, AuthPage, SettingsPage, etc.
│       ├── contexts/            AuthContext
│       ├── utils/               api.js (axios + endpoint helpers)
│       └── main.jsx
├── server/
│   ├── db/
│   │   ├── index.js             SQLite connection + migration runner
│   │   └── migrations/          *.sql files (ANSI-compatible)
│   ├── middleware/
│   │   ├── auth.js              JWT, requireAuth, optionalAuth, requireAdmin
│   │   └── sentry.js            Conditional Sentry init
│   ├── routes/                  Express routers
│   ├── utils/                   sheetStore, datasetStore, sharing, audit, etc.
│   ├── __tests__/               Vitest test suites
│   └── index.js                 Server entry point
├── Dockerfile                   Multi-stage build
├── docker-compose.yml
├── .github/workflows/ci.yml     GitHub Actions
└── vitest.config.js
```

---

## License

Proprietary — internal team project.

— Built by Laksh Sonwane, Darshan Patil, Jayesh Jadhav, Pranav Walunj
