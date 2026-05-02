import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, X, Sparkles } from 'lucide-react';

/**
 * GuidedTour — anchored tooltip walkthrough.
 *
 * How it works: each step is a config { selector, title, body, side }. The
 * tour finds the DOM element matching `selector`, draws a soft spotlight
 * around it, and positions a tooltip card next to it. Skip dismisses the
 * whole tour; "Got it" advances to the next step or finishes.
 *
 * Why not use react-joyride / shepherd? They're 50KB+ for what is, when you
 * look at it, ~80 lines of positioning logic. Building it ourselves keeps
 * the bundle smaller and lets us match the app's design language exactly.
 *
 * The tour is gated by localStorage. Once dismissed (skip OR finish), it
 * doesn't show again unless `Settings → Replay tour` is clicked (we add
 * that hook later).
 */

const STORAGE_KEY = 'wizTourCompleted_v1';

export function isTourCompleted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}
export function markTourCompleted() {
  try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
}
export function resetTour() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

// ─── TOUR STEPS ──────────────────────────────────────────────────────────────
// Selectors are data-tour-id attributes on real UI elements. The pages we
// updated for this — AnalysisPage and SheetBuilderPage — set those attrs.
const STEPS = [
  {
    selector: '[data-tour-id="auto-dashboard-btn"]',
    title: 'Start with Auto-Dashboard',
    body: "One click and Wiz lays out a complete dashboard. Best first move on any new dataset.",
    side: 'bottom',
  },
  {
    selector: '[data-tour-id="explore-btn"]',
    title: 'Then ask: what\'s interesting?',
    body: "Wiz scans every column and pair, ranks findings by interestingness, hands you a list. No prompting needed.",
    side: 'bottom',
  },
  {
    selector: '[data-tour-id="drivers-btn"]',
    title: 'Find what drives a number',
    body: "Pick any column. Wiz tells you which other columns most influence it — using real statistics, not guessing.",
    side: 'bottom',
  },
  {
    selector: '[data-tour-id="decomp-btn"]',
    title: 'Drill into the why',
    body: "Click a number, split it by a dimension, click a value to drill further. Power BI's most-loved view, done well.",
    side: 'bottom',
  },
];

// ─── PUBLIC COMPONENT ────────────────────────────────────────────────────────

/**
 * Hook to control the tour from a parent. Returns:
 *   { open, start, stop, skip }
 *
 * The tour auto-starts via `start()` — typically called once after the user
 * dismisses the welcome modal and the relevant page is mounted.
 */
export function useTour() {
  const [open, setOpen] = useState(false);
  return {
    open,
    start: () => setOpen(true),
    stop: () => { setOpen(false); markTourCompleted(); },
    skip: () => { setOpen(false); markTourCompleted(); },
  };
}

export default function GuidedTour({ open, onClose, steps = STEPS }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState(null);   // bounding rect of current target
  const tooltipRef = useRef(null);

  // Find the target element + measure it whenever the step changes.
  useEffect(() => {
    if (!open) return;
    const step = steps[stepIdx];
    if (!step) return;

    const find = () => {
      const el = document.querySelector(step.selector);
      if (!el) {
        // Element may not be mounted yet (especially during navigations).
        // Retry briefly. If never found, skip this step.
        return null;
      }
      // Scroll the element into view so the user can actually see what we're
      // pointing at.
      el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      return el.getBoundingClientRect();
    };

    let attempts = 0;
    const tryFind = () => {
      const r = find();
      if (r) {
        setRect(r);
      } else if (attempts++ < 20) {
        setTimeout(tryFind, 100);
      } else {
        // Couldn't find target — skip ahead. Better than freezing.
        if (stepIdx < steps.length - 1) setStepIdx(stepIdx + 1);
        else handleFinish();
      }
    };
    tryFind();

    // Re-measure on resize/scroll so the spotlight stays aligned.
    const measure = () => {
      const r = find();
      if (r) setRect(r);
    };
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, open]);

  // Reset to step 0 when reopened
  useEffect(() => {
    if (open) setStepIdx(0);
  }, [open]);

  const handleNext = () => {
    if (stepIdx < steps.length - 1) {
      setStepIdx(stepIdx + 1);
    } else {
      handleFinish();
    }
  };
  const handleSkip = () => handleFinish();
  const handleFinish = () => {
    markTourCompleted();
    onClose();
  };

  if (!open || !rect) return null;
  const step = steps[stepIdx];

  // Tooltip placement — keep it on screen by clamping to viewport.
  const PADDING = 12;
  const TOOLTIP_W = 320;
  const TOOLTIP_H_EST = 180;

  let tooltipTop, tooltipLeft;
  if (step.side === 'bottom') {
    tooltipTop = rect.bottom + PADDING;
    tooltipLeft = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  } else if (step.side === 'top') {
    tooltipTop = rect.top - TOOLTIP_H_EST - PADDING;
    tooltipLeft = rect.left + rect.width / 2 - TOOLTIP_W / 2;
  } else if (step.side === 'right') {
    tooltipTop = rect.top + rect.height / 2 - TOOLTIP_H_EST / 2;
    tooltipLeft = rect.right + PADDING;
  } else {
    tooltipTop = rect.top + rect.height / 2 - TOOLTIP_H_EST / 2;
    tooltipLeft = rect.left - TOOLTIP_W - PADDING;
  }
  // Clamp
  tooltipLeft = Math.max(PADDING, Math.min(window.innerWidth - TOOLTIP_W - PADDING, tooltipLeft));
  tooltipTop = Math.max(PADDING, Math.min(window.innerHeight - TOOLTIP_H_EST - PADDING, tooltipTop));

  // Spotlight: a clip-path ring around the target. The overlay is opaque-ish
  // black with a hole cut out where the target is.
  const SPOT_PAD = 8;
  const spotlightStyle = {
    top: rect.top - SPOT_PAD,
    left: rect.left - SPOT_PAD,
    width: rect.width + SPOT_PAD * 2,
    height: rect.height + SPOT_PAD * 2,
  };

  return (
    <div className="fixed inset-0 z-[200] pointer-events-none">
      {/* Overlay with a clipped-out hole. We use 4 rectangles around the
          target for the dim — simpler and more performant than CSS mask. */}
      <Overlay rect={rect} pad={SPOT_PAD} onClick={handleSkip} />

      {/* Highlight ring around the target */}
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="absolute rounded-xl pointer-events-none"
        style={{
          ...spotlightStyle,
          boxShadow: '0 0 0 3px rgba(233,165,33,0.6), 0 0 32px 4px rgba(233,165,33,0.35)',
        }}
      />

      {/* Tooltip card */}
      <motion.div
        ref={tooltipRef}
        key={stepIdx}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.2 }}
        className="absolute card-elevated p-4 pointer-events-auto"
        style={{
          top: tooltipTop,
          left: tooltipLeft,
          width: TOOLTIP_W,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <span className="text-2xs font-mono uppercase tracking-wider text-wiz-accent flex items-center gap-1">
            <Sparkles size={10} strokeWidth={2} />
            Tour · Step {stepIdx + 1} of {steps.length}
          </span>
          <button
            onClick={handleSkip}
            className="-mr-1 -mt-1 p-1 rounded text-wiz-text-tertiary hover:text-wiz-text"
            aria-label="Skip tour"
          >
            <X size={12} strokeWidth={1.75} />
          </button>
        </div>
        <h3 className="text-base font-display font-semibold text-wiz-text mb-1.5 tracking-tight">
          {step.title}
        </h3>
        <p className="text-sm text-wiz-text-secondary leading-relaxed mb-4">
          {step.body}
        </p>
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-xs text-wiz-text-tertiary hover:text-wiz-text"
          >
            Skip tour
          </button>
          <button
            onClick={handleNext}
            className="btn-primary text-xs py-1.5"
          >
            {stepIdx < steps.length - 1 ? <>Next<ArrowRight size={11} strokeWidth={2}/></> : 'Got it'}
          </button>
        </div>
        {/* Step pips */}
        <div className="flex items-center justify-center gap-1.5 mt-3">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1 rounded-full transition-all ${i === stepIdx
                ? 'w-6 bg-wiz-accent'
                : i < stepIdx ? 'w-1.5 bg-wiz-text-tertiary' : 'w-1.5 bg-wiz-border'
              }`}
            />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

/** Four-rect dim overlay — leaves the target rect clear. */
function Overlay({ rect, pad, onClick }) {
  const segments = [
    // top
    { top: 0, left: 0, right: 0, height: Math.max(0, rect.top - pad) },
    // bottom
    { bottom: 0, left: 0, right: 0, top: rect.bottom + pad },
    // left
    { top: rect.top - pad, height: rect.height + pad * 2, left: 0, width: Math.max(0, rect.left - pad) },
    // right
    { top: rect.top - pad, height: rect.height + pad * 2, left: rect.right + pad, right: 0 },
  ];
  return (
    <>
      {segments.map((s, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute bg-black/55 pointer-events-auto cursor-default"
          style={s}
          onClick={onClick}
        />
      ))}
    </>
  );
}
