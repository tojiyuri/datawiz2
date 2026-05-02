# Load testing Data Wiz

## TL;DR

```bash
# Terminal 1 — run the server
cd ~/Desktop/autowiz
npm run dev

# Terminal 2 — run the load test
node tools/loadTest.js --users=10 --duration=60
```

Read the output. Look at `event loop responsiveness` in particular.

## What the script does

`tools/loadTest.js` simulates concurrent users hitting the API with a
realistic workload mix. It:

1. Signs up a fresh test user (or logs in if the user already exists)
2. Uploads a synthetic 5,000-row CSV
3. Starts N concurrent "user loops" — each loop continuously picks an
   action (weighted by scenario), hits the API, records the latency
4. While the load is running, also pings `/api/health` once a second to
   measure event-loop responsiveness — a cheap GET that should always
   return in <10ms unless the loop is blocked
5. After the duration, prints a report and cleans up

No external dependencies — uses Node's built-in fetch.

## Scenarios

| Scenario | Use it to find |
|---|---|
| `mixed` (default) | General fitness — representative production traffic |
| `heavy-charts` | When does chart rendering choke under load? |
| `uploads` | Where does the upload pipeline break? |
| `reads` | Pure read perf — caching efficiency, query plan quality |

## What to look at in the output

### Event loop responsiveness
This is the most important metric. The probe pings `/api/health` once a
second from a separate "user." Expected results:

- **p99 < 50ms** — server is healthy; the event loop has time to spare
- **p99 50–200ms** — strain visible; some users are noticing slowness
- **p99 > 200ms** — event loop is blocked; the server is broken under
  this load. Find what's happening synchronously and either async-ify it,
  cache it, or rate-limit it.

### Per-action latencies (p50, p95, p99, max)
- p99 within 3-5x of p50 = healthy
- p99 = 50x+ p50 = there's a slow path firing for some users (cold cache,
  big dataset, etc.)
- max often gets weird with garbage collection — focus on p99

### Error rate
- < 1% — fine
- 1-5% — investigate the error samples printed below
- >5% — something is definitely broken; check server logs

## Tuning your test

```bash
# Find where it falls over
node tools/loadTest.js --users=10 --duration=30
node tools/loadTest.js --users=20 --duration=30
node tools/loadTest.js --users=50 --duration=30
node tools/loadTest.js --users=100 --duration=30
```

The user count where p99 ping crosses 200ms is your saturation point. On a
laptop in dev mode, expect this around 20-40 users. On a real production
host (more cores, no Vite running), maybe 60-150.

## Known limitations of this test

The test runs from one machine. So:
- It can't simulate true network distribution (real users hit you from
  multiple geographies)
- It can't push the server harder than the test machine itself can
- It doesn't measure Sentry/error-tracking overhead
- It doesn't run for hours, so memory leaks won't surface

For a real load test before going to production, consider tools like
[k6](https://k6.io) or [Locust](https://locust.io) running from a separate
machine, with longer durations and step-load patterns.

## What I'd predict you'll see (read this BEFORE running)

I read the code carefully before writing this script. My predictions, in
order from highest to lowest confidence:

### Likely (confidence: high)

**At 10 users, mixed scenario:** healthy. p99 ping under 50ms. Error rate
near zero.

**At 20–30 users, heavy-charts scenario:** event loop p99 climbs to
100-300ms. Chart rendering is fully synchronous on the event loop. While
one user's auto-explore runs, every other user's request queues.

**At 50 users, mixed scenario:** event loop p99 over 200ms. Some 429s start
appearing on auto-explore / drivers (the per-user rate limit kicks in —
this is **good**, it's the safety net working).

### Possible (confidence: medium)

**Memory growth under sustained load:** `process.memoryUsage().heapUsed`
grows steadily. Investigate which cache or which closure is holding
references.

**Cold-cache reads visible in latency tail:** `[DatasetStore] SLOW SYNC
READ` warnings in server logs, p99 of `render_chart` 5–10x p50 because
some requests hit cold cache and synchronously parse a 50MB JSON.

### What would surprise me

**Errors at low concurrency.** If you see auth failures or 5xxs at 5 users,
something is structurally wrong, not a load problem.

**SQLite write contention.** WAL mode handles up to ~1k writes/sec on
modern SSDs. We don't write that often.

## After you run it

Send me (or save):
- The full output of one run at your suspected saturation point
- Any `[DatasetStore] SLOW SYNC READ` warnings from the server logs
- Server `node --inspect` heap snapshot if it OOMs

The most useful follow-up is the next round of fixes targeted at what
**actually** broke, not what I guessed would break.
