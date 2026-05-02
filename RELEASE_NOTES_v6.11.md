# Data Wiz v6.11 — Automated Visualization

The shift from "tool that helps you build charts" to "tool that builds charts for you." Two new flagship features that put the product in conversation with industry-grade BI tools (Tableau Pulse, ThoughtSpot SpotIQ, Power BI Quick Insights):

## Auto-generate Dashboard

One click. Upload data → get a complete dashboard.

The system reads your dataset's column types, picks a primary measure (boosts revenue/sales-named columns), picks a primary dimension (prefers mid-cardinality categoricals like Region/Department), and lays out 4–6 charts that together survey the data:

- KPI tiles (sum + average of primary measure)
- Time trend (if a date column exists)
- Bar by primary dimension
- Top-10 view (only when cardinality is high enough to make it meaningful)
- Pie/share view (only when cardinality is low enough to render cleanly)
- Distribution histogram

Each chart gets a **stat-driven insight** rendered beneath it — "East accounts for 47% of Sales", "Productivity is increasing 15% per period" — so the reader gets the takeaway before parsing the chart.

The generator is conservative. It states facts, not interpretations. Where Tableau Pulse will say "your business has dangerous customer concentration risk," we say "Top 5 customers = 47% of revenue." That's the user's call to interpret.

Trigger: button on the Analysis page → `POST /api/auto/dashboard/:datasetId`.

Each generated chart becomes a saved sheet, so you can edit any of them. The dashboard itself is editable too — drag, resize, cross-filter normally.

## What's interesting?

The "tell me what I need to know about this dataset" feature.

Runs a multi-step scan across every column and column pair, computes findings using real statistics (no LLM in the critical path), ranks them by interestingness, returns the top 12.

Five finding types:

| Type | Trigger | Example |
|---|---|---|
| **Concentration** | Top N of M >> uniform distribution | "Top 5 of 30 customers accounts for 47% of Sales. 'Acme' alone is 14%." |
| **Outliers** | IQR-based, ≥0.5% of values | "102 values (10%) are outside the typical range. Most extreme: 1,496." |
| **Trend** | Linear regression with R² ≥ 0.15 and \|change\| ≥ 5% | "Sales has grown 23% over the period. Trend fit: R²=0.71." |
| **Correlation** | Pairwise Pearson, \|r\| ≥ 0.5 | "Strong positive correlation (r=0.78) between Sleep_Hours and Productivity." |
| **Group difference** | AVG comparison, top vs bottom ratio ≥ 1.5× | "Average Sales for 'East' (480) is 2.3× higher than 'South' (210)." |

Each finding includes:

- **Severity** — info / warning / critical, surfaced as a colored dot
- **Score** (0-100) — drives ranking
- **Evidence** — raw numbers (R², count, ratio, etc.) shown in a collapsible
- **Chart spec** — ready to render. One click opens a focused sheet pre-populated with the right fields.
- **Save** — turns the finding into a permanent sheet

Trigger: button on the Analysis page → `POST /api/auto/explore/:datasetId`. Loads in <100ms for typical datasets, samples to 50K rows for larger ones.

The Insights Feed page (`/explore/:datasetId`) shows the ranked feed with filter chips by type and severity.

## What I deliberately did NOT build

| Feature | Why not |
|---|---|
| LLM-generated narrative reports | LLMs hallucinate when summarizing data. Conservative facts > confident fiction. |
| Causal claims ("revenue dropped because X") | Causal inference is a research problem, not a product feature. |
| Continuous monitoring + alerts | Needs scheduler + notification infra. Out of scope for current architecture. |
| Forecasting in auto-dashboard | Half-built forecasts are worse than no forecasts. The v6.5 forecast feature stays as-is, not promoted. |
| Cross-dataset comparison findings | Single-dataset is hard enough done well. |

## Technical notes

**The pipeline runs in this order:**

```
explore(dataset, options)
  → sampleData(rows)              # downsample to 50K if needed
  → classifyColumns()              # numerics, categoricals, dates (skips IDs)
  → for each numeric:    outlierFinding()
  → for each cat × num:  paretoFinding(), groupDifferenceFinding()
  → for each date × num: trendFinding()
  → for each num × num:  correlationFinding()  (capped at 30 pairs)
  → rank by score, dedupe by chartSpec
  → return top N with scanStats
```

Every finding produces a `chartSpec` that the existing chart pipeline can render. No special chart code needed — auto-explore reuses everything in `sheetSpecBuilder`.

**Performance:** Bottleneck is correlation scan (O(n²) pairs × O(rows) per pair). The cap at 30 numeric pairs and 50K-row sample keeps the worst case under 200ms even for 25-column datasets.

**Determinism:** No LLM in the critical path. Same dataset → same findings. Optional LLM enrichment can sit on top later (the existing `llmInsightExplainer.js` plugs in here), but the engine is intentionally LLM-free.

## Files

**Added:**
- `server/utils/autoExplore.js` — multi-step finding scanner with 5 finding types
- `server/routes/auto.js` — `/api/auto/dashboard/:id`, `/api/auto/explore/:id`, `/api/auto/explore/:id/save-finding`
- `client/src/pages/ExplorePage.jsx` — ranked feed UI with type/severity filters

**Modified:**
- `server/index.js` — mount `/api/auto`
- `server/__tests__/autoVisualization.test.js` — refreshed for the new explore API
- `client/src/pages/AnalysisPage.jsx` — Auto-Dashboard + What's Interesting? buttons
- `client/src/pages/DashboardComposerPage.jsx` — per-tile insight footer
- `client/src/App.jsx` — `/explore/:datasetId`, `/dashboards/:id` routes
- `client/src/utils/api.js` — `generateAutoDashboard`, `exploreDataset`, `saveFindingAsSheet`

## Honest gaps

Even with v6.11, here's what's not yet at industry-product parity:

| Feature | Status |
|---|---|
| Auto-dashboard generation | ✅ |
| Per-chart insights | ✅ |
| Interestingness scan | ✅ |
| Save findings as sheets | ✅ |
| Anomaly detection | 🟡 IQR-based; isolation forests / DBSCAN would be better |
| Time-series anomaly detection | ❌ Not yet — current trend finding catches direction but not regime changes |
| Seasonality decomposition | ❌ Would need STL or Fourier — meaningful work |
| LLM-enriched insight prose | 🟡 Hook exists in `llmInsightExplainer.js` but not wired into autoExplore |
| Continuous monitoring + alerts | ❌ Out of scope |

The next high-leverage move is **wiring `llmInsightExplainer` into the explore pipeline as an optional enrichment** — keep the deterministic finding engine as the source of truth, let the LLM optionally rewrite the prose for plain-language readability. Cheap to add now that the foundation exists.

— v6.11
