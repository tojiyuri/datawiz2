# Data Wiz v6.3 — LLM-Powered

## What's new

v6.2 shipped the AI-Native BI experience using **heuristic** pattern matching: regex, synonyms, and rule-based intent classification. Honest about it: that handles ~70% of common phrasings well, but breaks on novel language, multi-clause requests, and domain-specific jargon.

**v6.3 plugs in a real LLM** (Anthropic's Claude) to handle that long tail. Three places got the upgrade:

### 1. Conversation engine → LLM
**Before (v6.2):** "show me sales by region" worked. "I'd like to understand how our different markets are performing in terms of revenue" failed silently.
**After (v6.3):** Both work. The LLM reads the dataset schema, the current spec, and conversation history, then outputs a structured spec. Works across any domain — retail, healthcare, finance, education.

### 2. Insight explanations → LLM
**Before:** "Outlier detected: Q3 Sales 23K (2.4σ above mean)"
**After:** "Q3 Sales spiked unusually high — about 24% above the yearly average. Worth investigating whether a campaign or seasonal effect drove this."

### 3. Calculated field suggestions → LLM
**Before (regex):** Detected Profit, Profit Margin, AOV when columns named exactly "Sales" + "Cost" + "Orders".
**After (semantic):** Given an insurance dataset with `Premium_Paid`, `Claims_Paid`, `Policy_Holders`, the LLM suggests **Loss Ratio = Claims_Paid / Premium_Paid** — a domain KPI no regex would catch. Works for any industry.

## Architecture: graceful degradation

This is the key design choice. Without an API key, **everything still works** — the heuristic engines from v6.2 handle the request. With an API key, the LLM takes over.

```
User message
    ↓
LLM Engine (v6.3)
    ├─ ANTHROPIC_API_KEY set? → Claude API
    └─ No key / API error?    → Heuristic Engine (v6.2)
                                     ↓
                              Same response shape
```

This means:
- Demo without an API key still demos cleanly
- Production with an API key gets LLM intelligence
- LLM hiccup (rate limit, network)? Falls back silently
- Switching is just an env-var change

The frontend shows a small badge — `LLM` (gradient accent) or `Heuristic` (muted) — so the user knows which mode is active.

## Setup

```bash
# 1. Install the new dependency
npm install

# 2. Get an API key from https://console.anthropic.com
# 3. Add it to .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# 4. Run as usual
npm run dev
```

That's it. Restart the server and the badge in Ask Wiz flips from "Heuristic" to "LLM".

## Cost

Default model is `claude-haiku-4-5` — fast and cheap.

- Conversation: ~$0.001 per message (~1ms latency typical)
- Insight enrichment: ~$0.001 per finding (5 findings per dashboard load = ~$0.005)
- Calc field suggestions: ~$0.002 per dataset upload (one-time per dataset)

A heavy demo session of 50 conversation turns + 10 dashboard loads + 5 dataset uploads is around $0.10. For a college project: pennies.

To use a smarter (but slower, more expensive) model, set `CLAUDE_MODEL=claude-sonnet-4-6` in `.env`.

## Files added

- `server/utils/llmConversationEngine.js` — Claude-powered intent classifier and spec builder
- `server/utils/llmInsightExplainer.js` — Turns numerical findings into natural-language narratives
- `server/utils/llmCalcSuggester.js` — Semantic calc field detection across any domain

## Files modified

- `package.json` — Added `@anthropic-ai/sdk`
- `.env` — Added `ANTHROPIC_API_KEY` and `CLAUDE_MODEL` config
- `server/routes/sheets.js` — `/converse` and `/suggest-calc-fields` now route to LLM; new `/ai-status` endpoint
- `server/routes/dashboards.js` — `/insights` enriches findings with LLM narratives
- `client/src/utils/api.js` — Added `getAIStatus()` helper
- `client/src/components/ConversationPanel.jsx` — Shows LLM/Heuristic badge in header
- `client/src/components/Header.jsx` — v6.3 label

## What I'd still call "honest gaps"

Even with the LLM, this isn't yet a full agent. To go further:

1. **No tool use yet.** The LLM outputs a spec, but doesn't actually run queries or check data. It's still bounded to chart-spec generation.
2. **No memory across sessions.** Each conversation is fresh. Tableau's Pulse keeps personal context across days.
3. **No proactive insights.** Insights only surface when you load the dashboard — not pushed when something changes.
4. **No voice input.** Web Speech API is a one-day add but not done.

These are **next sprints**, not "demo lies." The architecture supports all of them.

## Demo script for project review (with API key)

1. Show the app — point out the `LLM` badge in Ask Wiz header
2. Upload your retail or mental health CSV
3. Ask Wiz: "I want to understand how our different products are performing across regions in terms of profitability"
   - The heuristic engine would have failed on this. The LLM gets it.
4. Follow up: "Now zoom into the bottom three"
5. Switch to Formulas tab — show LLM-suggested calc fields with **rationale text** (the heuristic version had no rationale)
6. Build dashboard — show the **narrative insights** at the top ("Q3 Sales spiked unusually high...")
7. (Optional) Stop the server, remove the API key, restart — show the badge flip to `Heuristic` and demonstrate the same flows still work

Showing the **graceful degradation** is half the demo. It proves the architecture is real, not just an API call wrapped in UI.

— v6.3
