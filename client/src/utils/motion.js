/**
 * Motion language for Data Wiz.
 *
 * One source of truth for animations across the app. Inconsistent timing is
 * the single biggest reason apps feel cheap — a button that reacts in 80ms
 * next to a panel that reacts in 350ms feels broken even if both look fine
 * in isolation.
 *
 * The three curves cover almost everything:
 *   - SOFT_OUT:  data-shape-driven motion. Things settling into place.
 *   - SPRING:    interactive feedback. Buttons, hovers, drags. Has overshoot.
 *   - DAMPED:    big-block transitions. Pages, modals. No bounce.
 *
 * Every duration is one of three values: 150 (instant feedback), 250 (block
 * transitions), 400 (entrance reveals). Anything outside this range is a
 * smell.
 */

// ─── EASINGS ─────────────────────────────────────────────────────────────────

// Soft "expo out" — fast start, gentle settle. Use for state changes,
// reveals, and most layout motion. The same curve already used in CSS files.
export const EASE_SOFT_OUT = [0.16, 1, 0.3, 1];

// Spring-flavored cubic with a hint of overshoot. Use for hover responses
// and small interactive accents. Don't use for big motion — looks bouncy.
export const EASE_SPRING = [0.34, 1.56, 0.64, 1];

// Damped — clean ease-in-out, no overshoot. Use for big moves where the
// motion shouldn't draw attention to itself. Page transitions, modal show/hide.
export const EASE_DAMPED = [0.4, 0, 0.2, 1];

// Snap — sharp ease-out for instant-feedback things like taps and toggles.
export const EASE_SNAP = [0.25, 0.46, 0.45, 0.94];

// ─── DURATIONS (in seconds, for framer-motion) ───────────────────────────────

export const DUR_INSTANT = 0.12;    // taps, toggle indicators, focus rings
export const DUR_QUICK = 0.18;      // hover states, micro-interactions
export const DUR_NORMAL = 0.25;     // most state changes, panel reveals
export const DUR_DELIBERATE = 0.4;  // entrance animations, page reveals
export const DUR_SLOW = 0.6;        // hero animations, first-paint flourish

// ─── REUSABLE VARIANTS ───────────────────────────────────────────────────────

/**
 * Standard fade-up. Use on initial render of any panel/card.
 *   <motion.div {...fadeUp}>
 */
export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: DUR_NORMAL, ease: EASE_SOFT_OUT },
};

/**
 * Faster, smaller fade-up for items inside a list. Pair with stagger.
 *   <motion.li {...fadeUpItem}>
 */
export const fadeUpItem = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0 },
  transition: { duration: DUR_QUICK, ease: EASE_SOFT_OUT },
};

/**
 * Modal/overlay scale-in. Slightly bigger entrance, gentle exit.
 */
export const modalIn = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.98, y: 4 },
  transition: { duration: DUR_NORMAL, ease: EASE_SOFT_OUT },
};

/**
 * Page-transition variant. Direction is determined by the caller.
 * Pages slide up gently while fading.
 */
export const pageTransition = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: DUR_NORMAL, ease: EASE_DAMPED },
};

/**
 * Stagger container — children appear one after another with the given delay.
 * Use on lists/grids where the cumulative reveal feels intentional.
 */
export const staggerContainer = (childDelay = 0.04, initial = 0) => ({
  initial: 'initial',
  animate: 'animate',
  variants: {
    initial: {},
    animate: {
      transition: {
        staggerChildren: childDelay,
        delayChildren: initial,
      },
    },
  },
});

/**
 * Press feedback — scale down briefly when tapped. Pair with whileHover.
 *   <motion.button whileHover={hoverLift} whileTap={tapPress}>
 */
export const hoverLift = {
  scale: 1.015,
  y: -1,
  transition: { duration: DUR_INSTANT, ease: EASE_SPRING },
};

export const tapPress = {
  scale: 0.97,
  transition: { duration: 0.08, ease: EASE_SNAP },
};

/**
 * For buttons that shouldn't move spatially (table rows, nav items).
 * Just a touch of brightness/border response.
 */
export const subtleHover = {
  transition: { duration: DUR_QUICK, ease: EASE_SOFT_OUT },
};

// ─── CHART ANIMATION CONSTANTS ───────────────────────────────────────────────

// Recharts' default 1500ms ease feels old. These map to our timing.
export const CHART_ANIM = {
  duration: 600,           // milliseconds (recharts uses ms, not seconds)
  easing: 'ease-out',      // recharts only accepts CSS easing names
  begin: 0,
};

// For staggered chart entries (e.g., bars appearing one after another)
export const CHART_STAGGER_MS = 30;

// ─── ACCESSIBILITY: Respect reduced-motion preference ────────────────────────

/**
 * Returns true if the user has requested reduced motion. Use this to gate
 * animations or fall back to instant transitions.
 */
export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Returns the given variant if motion is enabled, else a no-op variant
 * that still triggers initial/animate/exit but with zero duration.
 */
export function respectMotion(variant) {
  if (prefersReducedMotion()) {
    return {
      ...variant,
      transition: { duration: 0 },
    };
  }
  return variant;
}
