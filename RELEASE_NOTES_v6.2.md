# Data Wiz v6.2 — AI-Native BI

## What's New

This is the release that makes Data Wiz **genuinely different** from Tableau / Power BI / Looker. Those tools have AI bolted on as a side feature. Here, AI is the default way you build.

### 1. Conversational Sheet Builder (the headline feature)

Click **Ask Wiz** in the top-right of any sheet. A chat panel slides in. Type:

> "show me sales by region"

→ The chart builds.

> "now break that out by product"

→ Product is added as a second dimension.

> "as a pie chart"

→ Chart type changes.

> "top 3 only"

→ Top-N filter applied.

> "show me profit"

→ Calculated field auto-created from Sales − Cost columns.

It's **multi-turn aware** — the AI knows what you've already built and modifies it incrementally. No drag-and-drop required (but still available alongside).

**Supported intents:**
- `create` — initial chart from natural language
- `add_field` — "now add quarter", "and product"
- `remove_field` — "drop the cost column"
- `change_chart` — "as a line chart"
- `change_aggregation` — "use average instead"
- `filter` — "only North and South", "where sales > 1000"
- `limit` — "top 5", "bottom 10"
- `create_calc_field` — "show profit", "what's the margin"
- `reset` — "start over"

### 2. Auto-Insights on Dashboard Load

Open any saved dashboard. A banner at the top automatically detects and surfaces the most interesting findings:

- **Outliers** — "North stands out at $5K — 4.5× the average"
- **Top movers** — "M12 leads with $430 (14% of total)"
- **Concentration** — "Top 2 products account for 67% of revenue"
- **Trends** — "Sales is trending up — +330% over the period"
- **Correlations** — "Sales and Cost are strongly correlated (r=0.92)"

Each insight is scored by "interestingness" (how far from baseline) and the top 5 across all tiles are surfaced. Click ↻ to refresh, dismiss with ✕.

### 3. AI-Suggested Calculated Fields

Open any sheet → Formulas tab. Wiz scans your column names and proactively suggests KPIs with one-click apply:

- See `Sales` + `Cost`? → Suggests **Profit**, **Profit Margin %**
- See `Visits` + `Conversions`? → Suggests **Conversion Rate %**
- See `Stress` + `Anxiety` + `Depression`? → Suggests **Wellness Score**
- See `Sales` + `Orders`? → Suggests **Average Order Value**

10 built-in pattern rules. Each shows confidence (85-95%) and explanation.

## Architecture

### Server
- `conversationEngine.js` — heuristic NL parser with 10 intent classifiers + multi-turn spec memory. **LLM-ready** — replace `classifyIntent()` with a model call later, the spec-merge logic is reusable.
- `calcFieldSuggester.js` — 10 pattern rules mapping field name combos to formulas
- `dashboardInsights.js` — scores 7 finding types per tile (outliers, trends, correlations, etc.) and ranks across the dashboard

### Client
- `ConversationPanel.jsx` — slide-in chat (bottom-right), starter prompts, suggested follow-ups, error handling
- `InsightFeed.jsx` — top-of-dashboard insight carousel
- AI suggestions integrated into the existing Formulas tab

## What v6.2 still doesn't have

Being honest:
- **Real LLM integration** — current AI is heuristic pattern matching. Works for ~80% of common requests. For longer-tail phrasing, you'd want OpenAI/Claude. The architecture supports drop-in.
- **Voice input** — could be added with Web Speech API in <100 lines
- **Insight explanations** — current insights state findings; future work: explain the "why" using simple causal heuristics
- **Memory across sessions** — Wiz doesn't currently learn your preferences between visits (the existing `learningEngine.js` could be wired here)

## Demo Script for Project Review

This is the demo that will land your AI-native pitch:

1. Upload mental_health_3000.csv
2. **Workbook → New Sheet**
3. Click **Ask Wiz** (top-right)
4. Type: `show me stress level by gender`
5. Type: `now add depression and anxiety levels`
6. Type: `as a grouped bar chart`
7. Switch to the **Formulas tab** — see Wiz already suggested **Wellness Score** based on your columns
8. Click the suggestion → instantly added as a calc field
9. Save sheet. Build 1-2 more.
10. **New Dashboard** → drag tiles in
11. The **AI Insight Feed banner** at the top automatically surfaces findings like "Anxiety and Depression are strongly correlated (r=0.91)"
12. Click bars to cross-filter (still works from v6.1)

## Run It

```bash
cd ~/Downloads && unzip -o DataWiz-v6.2-FullStack.zip && cd datawiz
npm run install:all
npm run dev
```

http://localhost:5173 — server on :8000.
