# Data Wiz v6.9 — Wiz Awakened

The Ask Wiz feature has been fully reborn. Two big shifts:

1. **Wiz is now powered by Claude with structured tool use**, not heuristic pattern-matching. Reliable, schema-aware, and aware of every v6.8 advanced calc feature.
2. **Wiz has a body.** A full-body animated SVG character that reacts to what's happening — thinking, working, celebrating, confused, sleeping.

## The new LLM brain

The old engine asked Claude to return a JSON blob and tried to parse it. JSON-in-prose is unreliable — Claude sometimes added preamble, sometimes wrapped in markdown fences, sometimes hallucinated fields. The new engine uses Claude's **tool use** API: Claude is given two tools (`update_chart`, `ask_clarifying_question`) with strict JSON schemas. Claude invokes one. The schema is enforced — no parsing fragility.

What this means in practice:

| Old behavior | New behavior |
|---|---|
| Sometimes returned `{ field, agg }` | Always returns `{ name, aggregation }` matching shelf shape |
| Knew about basic charts only | Knows about all v6.8 features: bins, sets, LODs, parameters, table calcs, hierarchies |
| Silently fell back to heuristic on errors | Surfaces errors to the UI; user can retry |
| Output: 50/50 valid JSON | Output: 100% valid spec or explicit clarification |
| No latency tracking | Reports `latencyMs` and `usage` per call |

The system prompt was completely rewritten: clearer personality, explicit guidance on which calc primitive to reach for in different scenarios, examples of advanced feature usage. The LLM now spontaneously suggests "hmm, that sounds like an LOD" when you say "show me each customer's % of their region."

### Heuristic engine still exists

When `ANTHROPIC_API_KEY` isn't set, the heuristic engine handles everything as before. The UI shows a yellow "Heuristic" badge instead of the green "Live" badge so you know which mode you're in.

## Wiz the character

Wiz is now a real animated character with a full body — head, torso, arms, legs, magic wand. He has:

- **Curly brown hair, brown skin, glasses** (matching the project's mascot brief)
- **Dark teal jacket, neutral shirt, dark pants, dark shoes**
- **A magic wand** with a glowing sparkle tip
- **Spontaneous blinking** at random intervals (every 2-5 seconds)
- **Six animation states**, each with distinct body/wand/face animations:

| State | When | What happens |
|---|---|---|
| **idle** | default | Gentle breathing, occasional blinks |
| **thinking** | LLM is processing | Hand to chin, body sways, "?" pops over head |
| **working** | mid-spec generation | Wand swings, sparkle particles fly out, mouth opens |
| **celebrating** | spec just succeeded | Jumps up and down, blush appears, ✦ stars burst out |
| **confused** | error or unclear request | Shakes side to side, eyes go wide |
| **sleeping** | idle for 60+ seconds | Body sways gently, "z" letters drift up |

Pure SVG + framer-motion. No images, no asset pipeline, no licensed art. Everything is procedurally drawn at any size, scales perfectly.

### Where Wiz appears

- **In the conversation panel header** — small (44px when expanded, 56px when collapsed)
- **As a 140px hero** when you first open the conversation with no messages — so first-run users see him in full
- **Next to every AI message** — small (28px), state matches that message's outcome
- **In the floating help button** — replaces the old static SVG mascot
- **In the typing indicator** — Wiz "thinking" while waiting for the LLM

The speech bubble for collapsed mode shows the latest reply for 5 seconds.

## How it feels in use

You open the panel and Wiz waves at you in idle state. You ask "show me sales by region" — Wiz immediately switches to thinking with a "?" floating up. The LLM call comes back, the spec applies, Wiz transitions to celebrating with sparkles for 1.5 seconds, then settles to idle.

If the LLM hits an error or the request is ambiguous, Wiz goes confused — shakes side to side, looks worried — and the message bubble has the clarifying question.

If you walk away for a minute, Wiz starts dozing.

## Files

**New:**
- `client/src/components/WizMascot.jsx` — full-body animated SVG character

**Rewritten:**
- `server/utils/llmConversationEngine.js` — tool use API, v6.8-aware system prompt, proper spec shape, error surfacing
- `client/src/components/ConversationPanel.jsx` — Wiz front and center, state-driven animations, latency display
- `client/src/components/AIAssistant.jsx` — uses new WizMascot instead of inline SVG

**Updated:**
- `client/src/components/Header.jsx` — version bump
- `server/index.js` — startup banner

## Setup

No new dependencies. Drop in over v6.8:

```bash
cd ~/Downloads
unzip -o DataWiz-v6.9-FullStack.zip
cd datawiz
npm run install:all
npm run dev
```

For full Wiz powers, add an Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-haiku-4-5-20251001
```

Without a key, Wiz still works in heuristic mode and the animation is fully present — just the brain is different.

— v6.9
