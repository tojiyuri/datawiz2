# v6.19 — Motion / craft pass

A focused motion design pass. The palette and layout are unchanged. What
changed is how things move, how they respond to interaction, and how they
load. The single biggest reason an app feels "cheap" or "real" lives in
these details, and this is the session for them.

## Motion language (the foundation)

`client/src/utils/motion.js` — one source of truth for every animation in
the app. Three curves cover almost everything:

- **EASE_SOFT_OUT** — the existing `cubic-bezier(0.16, 1, 0.3, 1)`. Things
  settling into place. Use for state changes, reveals, layout motion.
- **EASE_SPRING** — `cubic-bezier(0.34, 1.56, 0.64, 1)`. Hint of overshoot.
  Use for hover and small interactive accents only — never for big motion.
- **EASE_DAMPED** — `cubic-bezier(0.4, 0, 0.2, 1)`. Clean ease-in-out, no
  bounce. Use for big block transitions where motion shouldn't draw
  attention to itself.

Three durations: 120ms (instant feedback), 250ms (block changes), 400ms
(entrance reveals). Anything outside this range is a smell.

The file also exports reusable framer-motion variants (`fadeUp`, `modalIn`,
`pageTransition`, `staggerContainer`, `hoverLift`, `tapPress`) so common
patterns are one import away instead of inline-rolled.

## Concrete changes

### Page transitions (App.jsx)
The previous transition slid 20px with a 350ms duration. That's a lot of
travel — apps that travel that much feel slow even when they're not. New
values: 8px slide on enter, 4px on exit, 220ms duration, damped easing. The
result feels snappy without disorienting.

### Loading overlay
The full-screen spinner that shows during dataset upload has been
redesigned: concentric rings (outer rotates linearly, inner pulses), with a
solid amber dot at the center. Status text uses mono uppercase for the
sub-line which reads as "system is working" rather than "I'm trying."

### Chart entry (ChartRenderer)
Recharts defaults animations at 1500ms ease — the single biggest reason
charts feel old. CSS overrides set this to 600ms with our soft-out curve,
which means bars rise / lines trace / pies sweep at a speed closer to
modern tools.

The chart renderer now also wraps its output in a fade-up motion wrapper,
keyed by `${spec.type}-${spec.x}-${spec.y}`. Switching chart types
triggers a clean re-entrance instead of a frame-by-frame morph that often
looked half-broken.

### Active dot pulse (line/multi-line charts)
The dot that follows the cursor on a line chart now has a subtle spring
when it enters its active state (size animates with overshoot). Tiny
detail; lots of polish per pixel.

### Header tabs
The active-tab bar already used `layoutId` for the slide between tabs
(correct approach). Two improvements: spring softened from `stiffness: 500,
damping: 35` (snappy, almost mechanical) to `380, 32` (organic). Each tab
button also lifts -1px on hover and scales 0.97 on tap with the spring
curve. Subtle but present.

### Stat ribbon (AnalysisPage)
Was: opacity-only fade with 40ms stagger. Now: opacity + 6px y-translate,
50ms stagger, soft-out easing. The numbers feel like they "settle into
place" rather than "appear."

### Buttons (CSS-level)
- All `.btn-*` classes now have a press feedback (scale: 0.98) on `:active`.
  Tactile without being silly.
- Focus rings: only fire on `:focus-visible` (keyboard navigation), not on
  mouse click. Mouse users never see them; keyboard users get an
  amber-glow outline that's both accessible and on-brand.
- Inputs: focus ring is now a smooth animation (was a hard cut).

### Skeleton loaders (`components/Skeleton.jsx`)
A small set of placeholder components (`SkeletonLine`, `SkeletonTitle`,
`SkeletonChart`, `SkeletonCard`, `SkeletonGrid`, `SkeletonStatRibbon`) that
match the shapes of what's loading. Use these instead of bare spinners on
slow operations. Gradient shimmer animation is in `index.css` (`.skeleton`
class).

Not yet wired into every loading state in the app — that would have made
this session 3x as long. The components are there to be adopted as we go.

### Recharts polish (CSS)
- Tooltip wrapper transitions smoothly between positions instead of
  jumping.
- Tooltip cursor (the highlight bar/line under hover) fades in/out.
- Active dot's `r` (radius) animates with our spring curve.

### Scrollbar polish
Custom scrollbar (webkit + Firefox `scrollbar-color`) using surface colors
instead of the browser default. Thumb is `#2A2620` (matches our border),
hovers to `#3D3830`. Track is transparent. A small thing that signals
"someone cared."

### Text selection color
Default browser text selection is blue, which clashes badly with the warm
palette. Now uses amber tint: `rgba(233,165,33,0.32)`. Look for it next
time you select text.

### Pulse utilities
Two new utility classes:
- `.pulse-soft` — gentle scale + opacity for live indicators
- `.pulse-dot` — radial outward shadow pulse for "live" status dots

### Reduced motion (accessibility)
`@media (prefers-reduced-motion: reduce)` block reduces all animation
durations to 0.01ms. Required for vestibular disorder accessibility. Not
optional in 2026.

## What I deliberately didn't do

- **Animated number count-ups on the stat ribbon.** Looks fancy, slows down
  the user. The numbers should be readable as soon as they appear.
- **Page transition with route-based direction.** "Forward navigation goes
  right, back goes left" sounds clever, breaks every time someone uses
  browser back/forward. Stuck with vertical fade-up.
- **Spring physics on chart bars.** Recharts' SMIL animations don't expose
  spring physics — would need a custom layer. Not worth the effort for the
  marginal gain.
- **Animated focus rings that breathe.** Distracting under repeat use.
  Single fade-in is the right answer.
- **Toast notification reorders.** The current toast lib (react-hot-toast)
  handles this fine. Replacing it for marginal animation gains is a tax.
- **Wired skeleton loaders into every page.** The components are here.
  Adopting them across each loading state is a separate, mechanical pass —
  do it as you touch each page rather than a sweep.

## Where to use the new tools

When you write a new component:

```jsx
import { motion } from 'framer-motion';
import { fadeUp, hoverLift, tapPress } from '../utils/motion';

// Panel that fades up on mount:
<motion.div {...fadeUp}>...</motion.div>

// Interactive button:
<motion.button whileHover={hoverLift} whileTap={tapPress}>...</motion.button>
```

When you have a slow operation:

```jsx
import { SkeletonGrid } from '../components/Skeleton';

{loading ? <SkeletonGrid count={6} columns={3} /> : <ActualGrid />}
```

## Files changed

**New:**
- `client/src/utils/motion.js`
- `client/src/components/Skeleton.jsx`

**Modified:**
- `client/src/index.css` — focus rings, button press, skeleton, scrollbar,
  selection, pulse, recharts overrides, reduced-motion
- `client/src/App.jsx` — page transition timing + loading overlay
- `client/src/components/ChartRenderer.jsx` — wrapper motion + factored
  switch into helper function
- `client/src/components/Header.jsx` — softer spring + hover/tap on tabs
- `client/src/pages/AnalysisPage.jsx` — better stat ribbon stagger

— v6.19
