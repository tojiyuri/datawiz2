# v6.18 — Onboarding pass

The first five minutes used to be: land on upload page, drop a CSV, get
dumped into Analysis with no context. That's a 30-second-bounce experience.

This release builds the missing first-run flow.

## What's new

### 1. Welcome modal (first-run only)

`client/src/components/WelcomeModal.jsx` — shown the first time a user lands
on the app (gated by `localStorage[wizFirstRunShown_v1]`).

Two paths:
- **Try with sample data** (primary, amber CTA) — loads a baked-in 1,200-row
  e-commerce sales dataset, runs the full upload pipeline, drops the user
  on the Analysis page already populated. Lowest possible activation cost.
- **Upload my own** — closes the modal, normal upload flow.

Critical UX choice: we deliberately don't list features here. Showing a
working chart in 3 seconds beats describing what the tool can do.

### 2. Sample dataset

`client/public/sample-data.csv` — 1,200 rows. Every column type represented
(2 dimensions, 1 date, 4 measures, 1 high-cardinality categorical). The
data is constructed so that running through the tool produces interesting
findings:
- Top-region story (North America dominates by ~2.4×)
- Marketing_Spend correlates with Revenue (key driver test)
- Q4 seasonal lift (forecast pattern)
- Product/Segment interaction effects (decomposition tree story)

The sample is loaded via the existing `api.uploadFile()` path — no special
server-side handling. Same code path as a real upload.

### 3. Guided tour

`client/src/components/GuidedTour.jsx` — built from scratch, no library
(react-joyride is 50KB+ for what's ~80 lines of positioning logic).

Four-step tooltip walkthrough with anchored spotlights:
1. Auto-generate dashboard
2. What's interesting?
3. Key drivers
4. Decomposition tree

Auto-starts after sample-data load OR first real upload, gated by
`localStorage[wizTourCompleted_v1]`. Skip dismisses; "Got it" advances.

Implementation notes:
- Spotlight is a 4-rectangle dim overlay (no CSS mask) for compatibility
- Tooltip clamps to viewport on small screens
- Re-measures target on resize/scroll so spotlight tracks the element
- Retries up to 20 × 100ms for the target to mount before skipping ahead
- Element is scrolled into view via `scrollIntoView` so users actually see
  what we're pointing at

### 4. `data-tour-id` attributes on AnalysisPage

The four target buttons have `data-tour-id` attrs the tour selector finds:
`auto-dashboard-btn`, `explore-btn`, `drivers-btn`, `decomp-btn`.

### 5. Inline help banner on AnalysisPage

Dismissible banner that explains "best first move: try Auto-Dashboard."
Different localStorage key from the tour, so users who skipped the tour
still see this hint. Also persists dismissal.

### 6. Empty states

- `SheetsListPage.jsx` — replaced the bare "no dataset" guard with a real
  card-based empty state ("Your saved sheets will live here") + CTA to
  upload a dataset.
- `ReportsPage.jsx` — improved the "no dashboards" path with a centered
  card explaining what's needed and a "go build a dashboard" CTA.

## Files changed

**New:**
- `client/public/sample-data.csv`
- `client/src/components/WelcomeModal.jsx`
- `client/src/components/GuidedTour.jsx`

**Modified:**
- `client/src/App.jsx` — first-run gate, sample loader, tour orchestration
- `client/src/pages/AnalysisPage.jsx` — tour anchors + help banner
- `client/src/pages/SheetsListPage.jsx` — better no-dataset empty state
- `client/src/pages/ReportsPage.jsx` — better no-dashboards empty state

**localStorage keys introduced:**
- `wizFirstRunShown_v1` — welcome modal flag
- `wizTourCompleted_v1` — guided tour flag
- `wizAnalysisHelpDismissed_v1` — help banner flag

All `_v1`-suffixed so we can bump and re-show if the experience changes
materially.

## What I deliberately didn't do

- **No "skip to demo" video / animation.** Static banners load instantly
  and don't compete for attention with the actual UI.
- **No multi-tour.** One tour, one path, four steps. Adding more steps for
  every feature would dilute the signal.
- **No "tour replay" button in Settings.** Easy to add later, low value
  before any user feedback says they want it. The localStorage key can be
  cleared manually for now.
- **No A/B tracking on the funnel.** That's a tooling project, not a
  feature. Worth doing once you have actual users.
- **No customization of the sample dataset by industry.** "Sample for
  marketing analysts," "sample for finance," etc. is a real feature once
  you've picked a target customer. Premature now.

## What you should do next

The point of this release is so you **can show this to someone** without
the first 30 seconds being a wall. Find one person. Watch them. The thing
that breaks first is what to fix next. That signal is the gap I keep
asking you to close.

— v6.18
