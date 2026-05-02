# Running Wiz on a local LLM (Ollama)

Use this if you want Ask Wiz to run entirely on your own machine — no API key, no network calls, no per-request cost. Your data never leaves the laptop.

**Trade-off, plainly:** local models are noticeably worse at the structured tool use Wiz relies on. Field-name hallucinations and malformed specs happen more often. Latency goes from ~1 second (Claude) to 5-15 seconds (local). Use this if privacy or offline matters more than quality.

## 1. Install Ollama

Download for macOS, Linux, or Windows: **https://ollama.com/download**

Once installed, Ollama runs as a background service on `localhost:11434`. You can verify it's running:

```bash
curl http://localhost:11434/api/tags
```

(Should return JSON, not "connection refused".)

## 2. Pull a model

Ollama models are downloaded on demand. Pick one:

| Model | Size | Quality | Recommended for |
|---|---|---|---|
| `llama3.1:8b` | ~5 GB | OK | Laptops with 16 GB RAM |
| `qwen2.5:14b` | ~9 GB | Good | **Recommended starting point** |
| `qwen2.5:32b` | ~20 GB | Very good | Macs with 32 GB+ unified memory |
| `llama3.1:70b` | ~40 GB | Best (locally) | Workstations only |

```bash
ollama pull qwen2.5:14b
```

(One-time download. Takes a few minutes on a normal connection.)

## 3. Configure Data Wiz

In your `.env` file:

```dotenv
LLM_PROVIDER=ollama
OLLAMA_MODEL=qwen2.5:14b
OLLAMA_HOST=http://localhost:11434
```

If you want to use Claude when you're online and Ollama when you're not, leave `LLM_PROVIDER=auto` (the default) and set both `ANTHROPIC_API_KEY` and the Ollama config. Wiz will prefer Claude when the key is set.

## 4. Restart and verify

```bash
# Stop the server (Ctrl+C) and restart:
npm run dev
```

Open Ask Wiz. The status badge should now read **Local · qwen2.5:14b** in violet (instead of green "Live" for Claude or amber "Heuristic" for no LLM).

Type a request:

```
plot sales by region
```

You'll see Wiz's "thinking" animation for noticeably longer than with Claude — that's the local model running. The first request after a long idle is slowest because Ollama loads the model into memory; subsequent requests are faster.

## What works well, what doesn't

**Works well on local models:**
- Basic chart requests: "plot X by Y", "filter to Z"
- Chart type changes: "make it a line chart"
- Adding/removing fields

**Spotty on local models** (the spec validation layer catches these, so the chart still renders, but the result may be incomplete):
- LOD expressions (`{FIXED [Region]: SUM([Sales])}`)
- Complex calculated fields with IF/CASE
- Multi-step filtering with multiple conditions
- Table calcs (running totals, ranks, % of total)

**Reliable across both** (heuristic engine handles these):
- Single-step intent like "show me X"
- Simple top-N filters
- Chart type switching

## Troubleshooting

**Badge says "Heuristic" instead of "Local · ..."**

Ollama isn't reachable. Check:
- Is Ollama running? Look for the icon in your menu bar/taskbar.
- Try: `curl http://localhost:11434/api/tags` — should return JSON
- Try: `ollama serve` in a terminal (if it says "address in use", another instance is already running — that's fine)
- Is the model pulled? `ollama list` should show your model

**"I hit a snag (ollama)" toast appears**

The provider got an error. Check the server console — most common causes:
- Model name typo in `.env` (`qwen2.5:14b` not `qwen-2.5-14b`)
- Model not pulled yet
- Out of memory (model too big for your hardware)

**Responses are very slow**

First request after the model is idle takes longer (loading into memory). After that, expect 5-15 seconds per request on consumer hardware. If it's much slower:
- Switch to a smaller model: `OLLAMA_MODEL=llama3.1:8b`
- Close other memory-heavy apps

**Bad chart specs or wrong fields**

Local models hallucinate field names more than Claude. Wiz's validator filters out unknown fields, but you may end up with empty shelves. Try rephrasing to use exact column names from your dataset (e.g. say "Sales" instead of "revenue" if that's what the column is called).

## Going back to Claude

```dotenv
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Or just `LLM_PROVIDER=auto` — Wiz prefers Claude when the key is set.
