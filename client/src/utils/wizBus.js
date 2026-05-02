/**
 * Tiny event bus for Wiz animation cues.
 *
 * Used to send signals like "spec was just updated by Wiz" or "user is asking
 * a question" from anywhere in the app to the page-level <WizPlayground/>.
 *
 * Why an event bus instead of prop drilling?
 *
 *   - The conversation panel is buried 3 levels deep inside SheetBuilder
 *   - Wiz lives at the page level (so he can walk OUTSIDE the panel)
 *   - Pumping callbacks through every parent component is noisy
 *   - Events are sent from rare, well-defined moments — easy to reason about
 *
 * The bus is just a thin wrapper around browser CustomEvent so we don't pull
 * in a dependency. It's intentionally simple.
 */

const EVENT_NAME = 'datawiz:wiz';

/**
 * Emit a Wiz event. Cues are short string codes; data is whatever the
 * listener finds useful (e.g., chart bbox, intent name, error message).
 */
export function emitWizCue(cue, data = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { cue, data, at: Date.now() } }));
}

/**
 * Subscribe to Wiz events. Returns an unsubscribe function.
 */
export function onWizCue(listener) {
  if (typeof window === 'undefined') return () => {};
  const handler = (e) => listener(e.detail);
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

// Cue vocabulary — keep this list short and explicit. Adding a new cue means
// adding a new behaviour to the playground, so resist sprawl.
export const CUES = {
  THINKING: 'thinking',           // A request just went out to the LLM
  CHART_BUILT: 'chart_built',     // Spec successfully updated
  CHART_UPDATED: 'chart_updated', // Spec changed (lighter than CHART_BUILT)
  ERROR: 'error',                 // Conversation failed
  PANEL_OPENED: 'panel_opened',   // User opened Ask Wiz
  PANEL_CLOSED: 'panel_closed',   // User dismissed Ask Wiz
};
