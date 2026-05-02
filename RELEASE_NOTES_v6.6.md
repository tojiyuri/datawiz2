# Data Wiz v6.6 — Auth + Tests

The second foundational shift toward production. Authentication and multi-tenancy are wired end-to-end. A real test suite runs in CI-friendly time.

## What's new

### Authentication

- **Signup / login / logout** with httpOnly + SameSite cookies (XSS-resistant, CSRF-safe)
- **bcrypt** password hashing with cost factor 12 (~250ms — calibrated to defeat GPU brute-force, fast enough for UX)
- **Brute-force lockout**: 5 failed attempts in 15 minutes locks the account temporarily
- **JWT-signed access tokens** (7-day expiry by default, configurable via `JWT_EXPIRES_IN`)
- **First user becomes admin** automatically (bootstrap convenience for self-hosted deployments)
- **Tighter rate limiting on auth endpoints** (20 attempts / 15min per IP) on top of the global API limit
- **No email enumeration**: same error for "wrong password" vs "unknown email"
- **Bearer token support** for programmatic API clients (in addition to cookies)

### Multi-tenancy enforced end-to-end

- Every sheet, dashboard, and dataset has an `owner_id` populated on creation
- All store queries (`list`/`get`/`update`/`delete`) accept an `ownerId` filter
- All routes thread `req.user?.id` into every store call
- Cross-user access is silently denied (404 returned, not 403, to prevent ID enumeration)
- Legacy NULL-owner data (from before auth was wired) remains visible to all authenticated users — no orphans

### Test suite

Six test files, ~70 test cases, runs in under 5 seconds:

| File | What it covers |
|---|---|
| `auth.test.js` | Signup, login, password change, lockout, hashing, email normalization |
| `multitenancy.test.js` | Cross-user isolation at the store layer |
| `routes.test.js` | End-to-end via supertest — real Express app, real auth flow |
| `datasetOperations.test.js` | Union (3 modes) + Join (4 types) — pins down the v6.4 left-join bug |
| `formulaEngine.test.js` | Formula parser/evaluator, calculated fields, IF/THEN/ELSE |
| `jsonImporter.test.js` | v6.5 migration, including the corrupt-file scenarios |

Vitest with `pool: 'forks'` so each test file gets a fresh process and isolated DB. Run with:
```bash
npm test          # one-shot
npm run test:watch
```

## How auth works

```
┌─────────────────┐      POST /api/auth/login       ┌──────────────┐
│  React frontend │ ────────────────────────────► │ Express + JWT│
│                 │                                 │              │
│  AuthContext    │ ◄──── Set-Cookie: datawiz_auth ─│ bcrypt(12)   │
│  (useAuth hook) │       (httpOnly, SameSite)      │ +login_attempts
└────────┬────────┘                                 └──────┬───────┘
         │                                                 │
         │ Subsequent requests carry the cookie            │
         │ automatically (axios withCredentials: true)     │
         ▼                                                 ▼
   AuthGate redirects                            requireAuth middleware
   to /login if no user                          populates req.user
                                                          │
                                                          ▼
                                          stores filter by req.user.id
```

## Setup

```bash
cd ~/Downloads
unzip -o DataWiz-v6.6-FullStack.zip
cd datawiz

# Install (better-sqlite3 + bcrypt both compile native — about 30 seconds)
npm run install:all

# Generate a real JWT secret
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))" >> .env

# Run as usual
npm run dev

# Run tests in another terminal
npm test
```

On first visit, you'll be sent to `/signup`. The first account becomes admin.

If you're upgrading from v6.5: your existing sheets/dashboards/datasets stay accessible (NULL `owner_id` → visible to all authenticated users). They effectively get adopted by whoever logs in.

## What this NOW unblocks

With auth + tests in place, you can credibly:

- **Deploy publicly** (you have user isolation + brute-force protection)
- **Onboard real users** (signup flow exists)
- **Iterate confidently** (tests catch regressions in the riskiest code: joins, formulas, multi-tenancy)
- **Add team features** — sharing, permissions, sub-orgs are now incremental work on top of solid foundations

## Honest gaps still remaining

Even with v6.6, here's what's NOT industry-grade yet:

| Gap | Severity | Effort |
|---|---|---|
| Email verification | 🟡 | needs SMTP; 1-day sprint |
| Password reset flow | 🟡 | needs SMTP; 1-day sprint |
| OAuth / SSO | 🟡 | per-provider work; 1 day each |
| 2FA / MFA | 🟡 | TOTP via `otplib`; 2-3 days |
| Refresh token rotation | 🟢 | table is scaffolded; ~1 day to wire |
| Audit log | 🟡 | new `audit_log` table + insert middleware; 1 day |
| Sharing (sheets between users) | 🟡 | new `permissions` table + UI; 2-3 days |
| Sentry/error tracking | 🟡 | drop-in; ~2 hours |
| Docker / docker-compose | 🟡 | ~4 hours |
| GitHub Actions CI | 🟢 | run `npm test` on push; ~1 hour |
| Postgres migration path | 🟢 | swap driver; 1 day |
| Production frontend build pipeline | 🟡 | nginx in front of Express; 4 hours |
| Email-based password reset | 🟡 | requires SMTP/SendGrid; 1 day |

The next high-leverage move is **GitHub Actions CI + Sentry**: a few hours of work to get safety nets that catch problems before users do.

## Files

**Added:**
- `server/db/migrations/002_auth.sql` — email index, login_attempts, refresh_tokens (scaffolded)
- `server/utils/authStore.js` — bcrypt + user CRUD + brute-force lockout
- `server/middleware/auth.js` — JWT verify, requireAuth/optionalAuth/requireAdmin, signToken, cookie config
- `server/routes/auth.js` — signup/login/logout/me/change-password/status
- `server/__tests__/_setup.js` — per-process temp dir for SQLite isolation
- `server/__tests__/auth.test.js` — auth store unit tests
- `server/__tests__/multitenancy.test.js` — store-level isolation tests
- `server/__tests__/routes.test.js` — Express E2E with supertest
- `server/__tests__/datasetOperations.test.js` — union/join correctness
- `server/__tests__/formulaEngine.test.js` — formula parser + evaluator
- `server/__tests__/jsonImporter.test.js` — v6.5 migration robustness
- `vitest.config.js` — test config with forks pool
- `client/src/contexts/AuthContext.jsx` — useAuth hook
- `client/src/pages/AuthPage.jsx` — login + signup, first-run mode

**Modified:**
- `server/index.js` — cookie-parser, auth middleware on all data routes, exports `app` for testing
- `server/utils/sheetStore.js` — every CRUD function takes `ownerId` filter
- `server/utils/datasetStore.js` — every CRUD function takes `ownerId` filter; respects `DATAWIZ_TEST_DIR`
- `server/db/index.js` — respects `DATAWIZ_TEST_DIR` for tests
- `server/routes/sheets.js`, `dashboards.js`, `upload.js`, `connections.js`, `cleaning.js`, `analysis.js`, `nlp.js`, `dashboard.js`, `datasetCreate.js` — all thread `req.user?.id`
- `client/src/App.jsx` — AuthProvider + AuthGate + Navigate redirect
- `client/src/components/Header.jsx` — user menu with avatar + admin badge + logout
- `client/src/utils/api.js` — `withCredentials: true` for cookies; auth helpers
- `package.json` — bcrypt, jsonwebtoken, cookie-parser, vitest, supertest
- `.env` — JWT_SECRET, JWT_EXPIRES_IN

— v6.6
