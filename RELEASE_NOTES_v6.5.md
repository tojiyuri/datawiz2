# Data Wiz v6.5 — Persistent

The first foundational shift from "demo" to "production-grade." All persistent state moved from JSON files to SQLite. This eliminates an entire class of bugs and unblocks every other industry-grade feature you'll want next.

## What changed

### SQLite is now the system of record

Three things used JSON files for state. All three are now SQLite tables:
- **Sheets** — `data/sheets.json` → `sheets` table
- **Dashboards** — `data/dashboards.json` → `dashboards` table
- **Learning weights** — `data/learning.json` → `learning_weights`, `learning_context_weights`, `learning_history`, `learning_stats` tables

A new `users` table is **scaffolded but not wired** — once you add auth, the `owner_id` column on every row gets populated and queries get filtered by current user. Today, `owner_id` is always NULL (single-tenant fallback).

### Datasets now persist across restarts

Before v6.5: datasets lived in a `Map` in memory. `nodemon` reload = every uploaded file was gone. Users lost work.

After v6.5: dataset metadata is in SQLite, row data is on disk at `data/datasets/{id}.json`. An LRU cache keeps hot datasets in memory. **Server restarts no longer lose data.**

The 30-dataset, 30-day prune logic still runs at startup so the disk doesn't fill up forever.

### Migrations system

`server/db/migrations/001_initial.sql` defines the schema. The migration runner (`server/db/index.js`) tracks applied versions in a `schema_migrations` table. To evolve the schema later, drop a `002_*.sql` file in the directory — it runs on next start.

Each migration runs inside a transaction; failure rolls back cleanly.

### Auto-migration of legacy JSON state

`server/utils/jsonImporter.js` runs on first startup. If old `sheets.json`, `dashboards.json`, or `learning.json` exist, it imports their contents into the new tables, then renames the JSON files to `*.imported-{timestamp}.bak`. Idempotent — safe to run multiple times. No manual migration step.

If the old files are corrupt (e.g. the bare-array shape that broke v6.4 saves), the importer handles them gracefully and just doesn't import.

### Concurrency safety

WAL mode is enabled. Concurrent readers don't block writers. Two browser tabs saving the same sheet simultaneously will no longer corrupt the storage file (because the storage isn't a file anymore — it's transactional rows).

## What this unblocks

This is the foundation for several industry-grade features that were impossible on top of JSON files:

1. **Authentication** — adding a `users` table, login/signup routes, and bcrypt password hashing is now ~1 day of work (not "rewrite the whole storage layer first")
2. **Multi-tenancy** — adding `WHERE owner_id = ?` to every query is mechanical
3. **Audit logs** — add an `audit_log` table; insert on every mutation
4. **Sharing/permissions** — add a `sheet_permissions` table mapping sheets to user_ids
5. **Postgres deployment** — the SQL is ANSI-compatible. To deploy on Postgres, swap `better-sqlite3` for `pg`, change `INSERT OR IGNORE` syntax, done

## Public API: unchanged

This was a deliberate design constraint. The public functions on `sheetStore`, `datasetStore`, and `learningEngine` have **identical signatures** to v6.4. Routes don't change. Frontend doesn't change. Only the storage backend changed.

That's how you do a foundational refactor without breaking anything.

## Setup

```bash
cd ~/Downloads
unzip -o DataWiz-v6.5-FullStack.zip
cd datawiz

# Critical: install dependencies (better-sqlite3 needs native compile,
# which is fast on Mac — ~10 seconds)
npm run install:all

# Run as usual
npm run dev
```

On first start you'll see:
```
[DB] Applied migration: 001_initial
[DB] Connected to /path/to/datawiz/server/data/datawiz.db
[Importer] Migrated legacy JSON state: N sheets, N dashboards, N learning entries.
```

If you had v6.4 sheets/dashboards saved, they're now in the SQLite DB. Backups of the original JSON files are kept as `.imported-{timestamp}.bak` in case anything went wrong.

## What's NOT done (the next industry-grade sprint)

This was step 1. The full industry-grade gap from my last audit is still:

- 🔴 No authentication / users not wired
- 🔴 No tests (zero unit/integration tests in the codebase)
- 🟡 No error tracking (Sentry or equivalent)
- 🟡 No production frontend build pipeline (`npm run build` works but isn't served)
- 🟡 No Dockerfile / docker-compose
- 🟡 No CI/CD
- 🟡 No backup strategy beyond "the SQLite file is on disk"
- 🟡 Frontend dataset prop still in React state — survives navigation but not page refresh

The most impactful next step is **auth + tests**. With those done, you have a multi-user product that you can confidently ship and iterate on.

## Files

**Added:**
- `server/db/index.js` — connection manager + migration runner
- `server/db/migrations/001_initial.sql` — full initial schema
- `server/utils/jsonImporter.js` — one-time migration from legacy JSON

**Rewritten (same public API, different backend):**
- `server/utils/sheetStore.js`
- `server/utils/datasetStore.js`
- `server/utils/learningEngine.js`

**Modified:**
- `server/index.js` — initializes DB and runs importer at startup
- `client/src/components/Header.jsx` — version label

— v6.5
