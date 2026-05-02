# Hardening Pass — v6.15

The first round of "would this survive a real customer" review. The
discipline here was: **audit first, then fix the worst gaps**, with tests
that would have failed before each fix.

This is not a comprehensive security pass. It's the items I found in two
hours of staring at the code that I considered most likely to burn you.

## What I fixed

### CRITICAL: Tenant isolation leak in null-owner rows
**Files:** `datasetStore.js`, `sheetStore.js`

Both stores had clauses like `WHERE owner_id = ? OR owner_id IS NULL`. The
intent was to handle "legacy data from before auth was added" gracefully.
The effect was: **any dataset or sheet without an owner was visible to every
authenticated user**. In a multi-tenant deployment, this is a tenant data
leak — Tenant A could see Tenant B's data if it had ever been created
without an owner (which is what happens when a user is logged out, or when
imports come in via a script, or when migrations run).

Fixed by removing the OR-NULL clauses and treating null-owner rows as
unauthenticated-only. Test included that would have caught the original
leak.

### CRITICAL: 500MB request body limit
**File:** `server/index.js`

`express.json({ limit: '500mb' })` — half a gigabyte per JSON request.
A handful of concurrent attackers with one POST each could OOM the server
before even reaching application code. Reduced to 10MB. CSV uploads go
through multer (a different limit), so the 500MB was never serving a real
use case; it was just a DoS amplifier.

### HIGH: SSRF on SQL connector
**Files:** `sqlConnector.js`, new `ssrfGuard.js`

The SQL connector accepted any `host` field from the user. A malicious
tenant could:
- Connect to `localhost:5432` on the Data Wiz server itself
- Probe internal company infrastructure (`internal-db.company.local`)
- Hit cloud metadata endpoints (`169.254.169.254` for AWS IMDS)

Built `ssrfGuard.assertPublicHost()` that:
- Rejects all RFC 1918 private ranges (10/8, 172.16/12, 192.168/16)
- Rejects loopback (127/8, ::1) and link-local (169.254/16, fe80::/10)
- Rejects cloud metadata IPs and hostnames
- Rejects `.local`, `.localhost`, `.internal` suffixes
- Resolves DNS and rejects if **any** A/AAAA record points private (defeats
  DNS rebinding attacks)
- Allows operators to allow-list specific known-good internal targets via
  `ALLOWED_PRIVATE_HOSTS=db.internal,10.0.0.5`

Wired into `testConnection()` and `runQuery()` for postgres + mysql. SQLite
gets a separate fix.

### HIGH: SQL connector multi-statement / comment-bypass
**File:** `sqlConnector.js`

The "block DML/DDL" regex was bypass-able:
- `/* SELECT */ DROP TABLE users` — block by comment
- `SELECT 1; DROP TABLE users` — multi-statement (Postgres allows this)

Fixed by:
1. Stripping line + block comments before checking the regex
2. Rejecting any query containing `;` (after stripping a trailing one)
3. Expanded the keyword block list (added EXEC, CALL, MERGE, REPLACE,
   ATTACH, PRAGMA, etc.)

### HIGH: SQLite path traversal
**File:** `sqlConnector.js`

`new Db(config.file, ...)` accepted any path. A tenant could specify
`/etc/something.db` or any other readable file. Even though SQLite would
reject non-DB files, the connection attempts leak filesystem topology.

Fixed by `resolveSqlitePath()` — paths must resolve into
`SQLITE_ALLOWED_DIR` (defaults to `./uploads/sqlite/`) and any traversal
attempts (`..`) are rejected.

### HIGH: CSP disabled
**File:** `server/index.js`

`helmet({ contentSecurityPolicy: false })` — explicitly off. CSP is the
main browser-side defense against XSS amplification.

Fixed: full CSP enabled in production (`NODE_ENV=production`), with a
policy that allows our origin + Google Fonts + Anthropic API + denies
inline scripts beyond what the SPA bootstrap needs. Disabled in dev
because Vite HMR needs more leeway.

### HIGH: Upload — MIME sniffing, streaming, quota
**File:** `routes/upload.js`

Multiple issues:
1. `fileFilter` only checked extension. A renamed binary uploaded as `.csv`
   reached the parser. Added magic-byte sniffing before parse.
2. `fs.readFileSync` for JSON loaded entire 200MB files into memory at
   once. Capped JSON at 50MB; pointed users at JSONL for streaming.
3. JSONL did `text.split(/\r?\n/)` — same memory issue. Replaced with
   line-by-line stream parser.
4. `XLSX.readFile` runs with default options that include formula
   evaluation and style processing — both have had CVEs (CVE-2023-30533).
   Now passes `{cellFormula: false, cellStyles: false, bookVBA: false}`
   for minimum-attack-surface mode.
5. Per-tenant dataset quota: was zero. Now `MAX_DATASETS_PER_TENANT=50` by
   default. One user can no longer fill the disk.
6. Default file size: was 200MB, now 100MB (configurable via env). The
   right answer here is "depends on your customer base"; defaulting smaller
   is safer.

### MEDIUM: trust proxy
**File:** `server/index.js`

When deployed behind a load balancer, `req.ip` is the LB's IP unless Express
is told to trust the proxy header. Without this, all rate limits become
*global* (one bad actor blocks everyone). Added `TRUST_PROXY` env support.

## What I did NOT fix in this pass — and why

These are real gaps. They need either more time, more architectural
decisions from you, or both.

| Gap | Why deferred |
|-----|-------------|
| **No malware scanning on uploads** | Needs ClamAV daemon or a cloud service (Cloudflare R2 + scan, AWS S3 + Lambda). Architectural decision: where does it run, who pays for it? |
| **xlsx library has had CVEs** | The mitigations I applied (cellFormula/cellStyles/bookVBA off) close most known holes, but the library itself is the wrong dependency long-term. Replace with `exceljs` in a future pass. |
| **No CSRF tokens on auth flows** | We use SameSite=Lax cookies which protects against most CSRF, but a real defense-in-depth review would add CSRF tokens on state-changing endpoints. Not free, needs UX discussion. |
| **Per-tenant query rate limits** | Currently global. A heavy autoExplore call from one tenant slows every tenant. Needs tenant-aware Redis-backed rate limiting. Architectural project. |
| **Encryption at rest for SQLite** | Customer data is in plain SQLite. For SOC 2 / HIPAA / etc., this is a blocker. Would move to Postgres + TDE, which is a multi-day migration. |
| **No security headers beyond Helmet defaults** | HSTS, Permissions-Policy, etc. — easy adds, just didn't get to them. |
| **No incident response logging** | Audit log exists for user actions, but no separate security event log (failed auth burst, SSRF attempt blocked, multi-statement SQL rejected). Useful for compliance later. |
| **Refresh token rotation theft detection** | Code path exists from v6.7 but I didn't audit whether the detection actually works under all races. Worth a dedicated test session. |
| **Memory leak audit** | Long-running sessions, the `wizMemory` learner, the cache — none of these have been profiled under sustained load. The "load test" task on the menu would surface these. |
| **No DB migrations rollback path** | Migrations are forward-only. A bad migration corrupts the DB. Needs a real migration tool (knex, drizzle, prisma migrate). |

## What you should do next

In rough priority order:

1. **Pick one real customer and watch them use it.** I keep saying this. It's still the most important thing.
2. **Run the load test option from the original menu.** That'll surface
   memory leaks and rate-limit concerns I can't find by reading.
3. **Decide on Postgres migration.** SQLite is a fine dev choice but it's
   the long-term blocker on real ops. Move soon, before you have data
   you're afraid to migrate.
4. **Get a real pentest** when you have a paying customer. A $5K-$10K
   engagement from a small firm finds things I won't.

## Files

**New:**
- `server/utils/ssrfGuard.js` — outbound connection validation
- `server/__tests__/hardening.test.js` — tests for each fix

**Modified:**
- `server/index.js` — body limits, CSP, trust proxy
- `server/utils/datasetStore.js` — tenant isolation
- `server/utils/sheetStore.js` — tenant isolation (sheets + dashboards)
- `server/utils/sqlConnector.js` — SSRF guard, multi-statement, SQLite path
- `server/routes/upload.js` — MIME sniff, streaming, quota, hardened xlsx

**Env vars introduced:**
- `MAX_UPLOAD_SIZE_MB` (default 100)
- `MAX_DATASETS_PER_TENANT` (default 50)
- `ALLOWED_PRIVATE_HOSTS` (comma-separated, default empty)
- `SQLITE_ALLOWED_DIR` (default `./uploads/sqlite`)
- `TRUST_PROXY` (default off; set to `'1'` behind a single LB)

— v6.15
