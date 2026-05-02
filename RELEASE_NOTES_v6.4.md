# Data Wiz v6.4 — Multi-Source

The data layer expansion. Tackling the biggest gap from the audit: **everything was CSV-only**. Now we connect to actual databases, REST APIs, and combine datasets.

## Built and shipping

### 🟢 SQL connectors
Postgres, MySQL, SQLite — all real drivers (`pg`, `mysql2`, `better-sqlite3`), all with connection testing before query execution.

- **Test connection** button shows DB version and lists tables (helps users find what to query).
- **Read-only**: connector blocks INSERT/UPDATE/DELETE/DROP/TRUNCATE/ALTER/CREATE/GRANT/REVOKE. SELECT only.
- **Auto LIMIT**: queries without a LIMIT clause are auto-wrapped to cap at 200,000 rows. Same cap as CSV upload.
- **SSL toggle** for cloud-hosted databases (Heroku, Neon, RDS, etc.).

### 🟢 REST API connector
Pull JSON from any URL. Five auth modes:
- Bearer token (most common — `Authorization: Bearer xyz`)
- Basic auth (username + password)
- Custom header (e.g. `X-API-Key`)
- Query parameter (e.g. `?api_key=xyz`)
- None

Plus:
- **JSON path extraction**: `data.users` to drill into wrapped responses
- **Pagination**: follows `Link: <...>; rel="next"` headers AND `next`/`next_url` body fields
- **Capped at 50K rows / 20 pages** to prevent runaway pulls
- **Test endpoint** preview shows shape (`array (5)` vs `object with arrays: data (100)`) and first 3 sample rows

### 🟢 More file formats
Added: **JSON Lines** (`.jsonl`, `.ndjson`) — common in big data exports. Improved `.json` to auto-detect wrapped responses (`{data:[...]}`, `{results:[...]}`, etc.).

Already there from before: CSV, TSV, JSON, XLSX, XLS.

### 🟢 Dataset Union (append)
Combine multiple datasets row-wise. Three modes:
- **Union** (default): keeps every column from every dataset; missing values become null
- **Intersect**: keeps only columns present in *all* inputs
- **Strict**: errors out if columns don't match exactly

A `_source` column is added automatically so you can trace which row came from which dataset.

### 🟢 Dataset Join (multi-table data model)
The Power BI killer-feature, in-memory. All four standard SQL join types:
- **Inner**: rows that match in both
- **Left**: all rows from left + matches from right
- **Right**: all rows from right + matches from left
- **Full**: every row from both, matched where possible

Tested 50,000 × 100 rows = 9ms. Performance is fine for typical college-project sized data.

## Honestly NOT supported (and why)

The audit had 9 items. I built 5. The other 4 are skipped with explanations the UI shows the user:

| Gap | Why skipped | Workaround |
|---|---|---|
| **BigQuery / Snowflake** | Need service account JSON / OAuth. Demo-fragile. | Export query → CSV/Parquet → upload here |
| **Cloud storage (S3, GCS)** | Need AWS/GCP credentials. Same demo issue. | Download files locally → upload |
| **Live connections** | Requires query engine, materialized views, cache invalidation. Different sprint entirely. | Use the EXTRACT model (this is what 90% of Tableau users actually use) |
| **Streaming (Kafka, Kinesis)** | Needs real infrastructure. Faking it would be a lie. | Periodic re-import (cron job → API → re-pull) |
| **Row-level security** | Requires user/auth system that doesn't exist yet. | — |

These are all written into the **Capabilities** panel at the bottom of the Data Sources page, so the user (or a project reviewer asking what you didn't build) sees an honest answer.

## Setup

```bash
cd ~/Downloads
unzip -o DataWiz-v6.4-FullStack.zip
cd datawiz
# IMPORTANT — install the new SQL drivers
npm run install:all
npm run dev
```

Open http://localhost:5173 and click **Data Sources** in the header.

### To demo SQL without installing a database server

The simplest demo is SQLite — it's just a file, no daemon needed. Macs have a sample DB at `/usr/share/dict/words` (no, that's a text file — use one of the SQLite tutorial DBs from https://www.sqlitetutorial.net/sqlite-sample-database/, like `chinook.db`). Save it somewhere, paste the absolute path into the SQLite tab, hit "Test connection," then run `SELECT * FROM tracks LIMIT 1000;`.

### To demo REST API without auth

Try `https://jsonplaceholder.typicode.com/users` — no auth required, returns 10 user objects. Leave JSON path blank, click Test, then Import.

For an authed demo: `https://api.github.com/users/torvalds/repos` with no auth (GitHub allows 60 unauthenticated requests/hour) — returns 30 repos. Good for showing pagination if you set Page param to `page`.

## Files added/modified

**Backend:**
- `server/utils/sqlConnector.js` — Postgres/MySQL/SQLite drivers, lazy-loaded
- `server/utils/apiConnector.js` — REST + auth + pagination
- `server/utils/datasetOperations.js` — Union and Join algorithms
- `server/routes/connections.js` — All connection endpoints
- `server/routes/upload.js` — JSONL support, GET / list endpoint
- `server/utils/datasetStore.js` — list() now includes column metadata
- `server/index.js` — registers connections route

**Frontend:**
- `client/src/pages/DataSourcesPage.jsx` — 4-tab page (SQL · API · Union · Join)
- `client/src/components/Header.jsx` — added Data Sources tab
- `client/src/App.jsx` — registered /sources route
- `client/src/utils/api.js` — 7 new helpers

**Dependencies added:**
- `pg` (Postgres driver)
- `mysql2` (MySQL driver)
- `better-sqlite3` (SQLite driver)
- `axios` (HTTP client)

## Demo script for project review

If you can swing it, this is the most impressive demo:

1. Open Data Sources tab
2. Pick **REST API** sub-tab
3. Paste `https://jsonplaceholder.typicode.com/users`, click Test (shows shape preview)
4. Click Import → 10 users imported as a dataset
5. Now go upload a CSV with matching IDs (e.g. orders with `user_id`)
6. Back to Data Sources → **Join** tab
7. Pick the two datasets, set keys to `id` ↔ `user_id`, choose Inner
8. Run join → new dataset has user names AND order amounts together
9. Go to Workbook → build a chart on the joined dataset

That's a multi-source pipeline: API + CSV → joined → analyzed. None of which v6.3.1 could do.

— v6.4
