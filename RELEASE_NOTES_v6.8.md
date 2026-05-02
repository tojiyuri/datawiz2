# Data Wiz v6.8 — Advanced Calculations

The fourth foundational shift: from "deployable system" to "real BI tool." This release is what separates basic dashboards from analytics that match Tableau-class capability.

Six new calc primitives, all working through a single redesigned pipeline.

## What's new

### 🪄 Window functions (table calcs)

After your chart aggregates, walk the result table to compute things like running totals and rankings:

- `RUNNING_SUM`, `RUNNING_AVG`, `RUNNING_MIN`, `RUNNING_MAX`, `RUNNING_COUNT`
- `MOVING_AVG(field, n)`, `MOVING_SUM(field, n)`
- `WINDOW_SUM`, `WINDOW_AVG`, `WINDOW_MIN`, `WINDOW_MAX` (whole-partition aggregates)
- `RANK`, `DENSE_RANK`, `INDEX`
- `LOOKUP(field, offset)` — get value from N rows away
- `DIFFERENCE`, `PERCENT_DIFFERENCE` — period-over-period
- `PERCENT_OF_TOTAL` — share of partition total

Calcs chain — later ones can reference earlier ones in the same calc list. Optional `partitionBy` resets the calc per group.

### 🎚 Parameters

User-controllable variables that show up in formulas, filters, and bins. Type-aware:

- `number` — slider control with min/max/step
- `string` — text or dropdown with `allowedValues`
- `boolean` — toggle
- `date` — date picker

Reference them three ways: `@Threshold`, `[@Threshold]` (Tableau-style brackets for spaces), `@"My Param"`. Substitution happens before formula evaluation, so `[Sales] > @Threshold` becomes `[Sales] > 1000` at runtime.

### 🔢 Bins

Group continuous values into discrete buckets:

- **equal-width** — N evenly-spaced ranges. Predictable, easy to read.
- **quantile** — N buckets each with ~equal row count. Better for skewed data.
- **custom** — user-supplied edges + optional labels. e.g. age groups `[0, 18, 35, 50, 65, 100]`.

Bins create a derived column on every row (it's a row-level transformation, applied before aggregation).

### 🎯 Sets

Manually-selected groups that act as dynamic in/out filters. Three modes:

- **manual** — explicit list of values
- **top-N / bottom-N** — computed by aggregation: `Top 10 customers by SUM(Sales)`
- **condition** — values matching a comparison: `Sales > 1000`

Each row gets a categorical column with `In <set>` or `Out of <set>`. Useful as filters, color encodings, or grouping dimensions.

### 🪜 Level of Detail (LOD) expressions

`{FIXED [Region]: SUM([Sales])}` — aggregate at a different granularity than the chart's view. The killer feature for advanced calcs.

LODs run BEFORE filtering and other calcs. They compute the aggregate per FIXED partition once, then broadcast that value to every row. That lets you compute things impossible with row-level + aggregate calcs alone:

```
{FIXED [Region]: SUM([Sales])}              → "Region Total"
[Sales] / [Region Total] * 100              → "% of Region"
```

Now the chart can show each customer's contribution to their region's total — even when the chart is viewing customers without grouping by region.

**Scope:** `{FIXED}` only in this release. `{INCLUDE}` and `{EXCLUDE}` require knowing the chart's view at calc time, which is real engineering and not yet wired. ~80% of LOD usage in real dashboards is FIXED, so this covers the vast majority of cases.

### 🌳 Hierarchies + drill-down

Define ordered chains like `Country → State → City`. The chart aggregates at the current level. Click a value to drill in (filter to that value AND advance to the next level). Breadcrumbs to drill back out.

Drill state lives in the sheet spec, so saved sheets remember the user's drill path.

## How they fit together — the pipeline

The chart builder now runs this pipeline on every render:

```
1. Substitute parameters in calc field formulas
2. Apply LODs (fixed-granularity aggregates broadcast to source rows)
3. Apply bins (row-level → adds bucketed columns)
4. Apply sets (row-level → adds in/out group columns)
5. Apply calculated fields (row-level + aggregate formulas)
6. Apply hierarchy drill (filter to drill path)
7. Apply filters + cross-filter
8. Aggregate / shape chart data
9. Apply table calcs (post-aggregation, on chart-shaped data)
10. Generate insights + return
```

Each stage is its own module with its own tests. Add a new calc primitive by writing one new module + adding one line to the pipeline.

## Configuring all this

The Sheet Builder has a new **Advanced** tab in the left sidebar with collapsible sections for each feature. Each section adds quick-start defaults — pick a column, pick a strategy, hit Add.

For table calcs there's a "Quick add" picker with pre-built expressions: running total, moving avg, % of total, rank desc, period-over-period, YoY % change, lookup prior row.

## Tests

11 test files now (~120 cases). New `advancedCalcs.test.js` covers every primitive with property tests and edge cases. The existing chart pipeline tests still pass — the new modules are additive.

```bash
npm test
```

## Setup

This release adds no new dependencies. Drop in over v6.7:

```bash
cd ~/Downloads
unzip -o DataWiz-v6.8-FullStack.zip
cd datawiz

# Install (existing deps — no new packages)
npm run install:all

# Run dev (or your existing setup)
npm run dev
```

Existing v6.6/v6.7 sheets continue to work — the new spec fields default to empty arrays, so old saved sheets are forward-compatible.

## Files

**Added:**
- `server/utils/tableCalcs.js` — window functions / table calcs
- `server/utils/bins.js` — equal-width / quantile / custom binning
- `server/utils/sets.js` — manual / top-N / condition sets
- `server/utils/lod.js` — `{FIXED}` LOD expressions
- `server/utils/parameters.js` — parameter validation + substitution
- `server/utils/hierarchies.js` — drill-down state machine
- `server/__tests__/advancedCalcs.test.js` — comprehensive test suite
- `client/src/components/AdvancedCalcsPanel.jsx` — UI for all six features

**Modified:**
- `server/utils/sheetSpecBuilder.js` — runs the new pipeline stages in correct order
- `client/src/pages/SheetBuilderPage.jsx` — Advanced tab + state for new features
- `client/src/components/Header.jsx` — version bump
- `server/index.js` — startup banner version bump

## Honest gaps still remaining

Even with v6.8, here's what's NOT yet at full Tableau parity:

| Feature | Status |
|---|---|
| Calculated fields with row-level + aggregate logic | ✅ |
| Window functions / table calcs | ✅ |
| Parameters | ✅ |
| Bins | ✅ |
| Sets | ✅ |
| `{FIXED}` LOD | ✅ |
| `{INCLUDE}` / `{EXCLUDE}` LOD | 📝 Scaffolded — view-aware engine pending |
| Hierarchies + drill | ✅ |
| Top-N filter (filter context) | 🟡 Sets cover this for dimension filtering |
| Reference lines / bands | ❌ Not yet — chart-rendering concern |
| Forecasting | 🟡 Basic linear forecast exists; advanced models pending |
| Trend lines (chart overlay) | ❌ Not yet |
| Custom geocoding | ❌ Not yet |
| Polygon / spatial joins | ❌ Not yet |

The next high-leverage items are reference lines (chart annotation layer) and trend lines (regression overlay) — both are chart-rendering concerns rather than data pipeline concerns, and would build on the existing recharts setup.

— v6.8
