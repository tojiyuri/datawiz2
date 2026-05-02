# Data Wiz v6.1 — Industry Build

## What's New in v6.1

### 1. Calculated Fields (Tableau-style formulas)
Open any sheet → Formulas tab → New. Write formulas with:
- **Field refs**: `[Sales] - [Cost]`
- **Aggregates**: `SUM([Sales]) / SUM([Cost]) - 1`
- **Conditionals**: `IF [Sales] > 1000 THEN "High" ELSE "Low" END`
- **Multi-branch**: `CASE [Region] WHEN "North" THEN 1 WHEN "South" THEN 2 ELSE 0 END`
- **Math**: `ROUND(([Sales] - [Cost]) / [Sales] * 100, 1)`
- **Text/Date**: `CONCAT`, `UPPER`, `YEAR()`, `DATEDIFF()`, etc.

Live syntax validation, click-to-insert fields, function reference panel.

### 2. Advanced Filters
Sidebar → Filters tab. Type-aware UI:
- **Categorical**: multi-select from distinct values
- **Numeric**: range, comparison ops
- **Top-N / Bottom-N**: rank by any measure (sum/avg/count/min/max)

### 3. Cross-Filtering Between Tiles
On any dashboard, **click a bar/segment** in tile A → all OTHER tiles re-filter on that value. Click again to clear. The source tile gets a "FILTER SRC" badge.

### 4. Polished Dashboard UX
- **Drag-resize**: grab the bottom-right corner of any tile
- **Undo/Redo**: ⌘Z and ⌘⇧Z (or Ctrl on Linux/Windows). 30-state history.
- **Export**: PNG download (rasterized) or JSON (re-importable spec)

### 5. Multi-Field Bug Fix (the screenshot bug)
Dropping 3 measures + 2 dimensions on a Bar chart now produces a grouped multi-bar with all 3 measures as series. Warns about the ignored second dimension.

## Demo Script (for project review)

1. **Upload** a sales CSV with Region, Product, Sales, Cost, Date columns
2. **Workbook → New Sheet** → drop Region on Cols, Sales on Rows → Save
3. **Formulas tab** → New → name "Profit", formula `[Sales] - [Cost]` → see live ✓ → Create
4. Drop Profit on Rows → see Profit chart
5. **Filters tab** → Add → Region, Top 5 by Sales → applied
6. Save sheet, create another (Pie of Region by Sales), save
7. **New Dashboard** → drag both sheets in
8. **Click a Region bar** → other tile filters → ⌘Z to undo, ⌘⇧Z to redo
9. **Export PNG** to share

## What v6.1 Does NOT Do (and why)
- **SQL connectors** (Postgres/MySQL/etc): huge surface area; deferred to scope better
- **1M+ row Web Worker pipeline**: current 200K @ 2.5s is acceptable for demo data
- **Joins/relationships**: out of scope for single-CSV use case

## Run It
```bash
cd ~/Downloads && unzip -o DataWiz-v6.1-FullStack.zip && cd datawiz
npm run install:all
npm run dev
```
Open http://localhost:5173. Server runs on :8000 (Mac AirPlay-safe).

## Architecture Reference
- **formulaEngine.js**: hand-written recursive-descent parser. No `eval`, safe.
- **filterEngine.js**: declarative filter spec applier with top-N rank-by-measure support
- **sheetSpecBuilder.js**: orchestrates calc fields → filters → cross-filter → chart spec
- Cross-filter is implemented as a special filter applied to all non-source tiles
- Undo/redo uses a snapshot history of the tiles array (not a command/operation stack — simpler, equally effective for this scope)
