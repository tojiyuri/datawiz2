import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WizMascot from './WizMascot';
import { onWizCue, CUES } from '../utils/wizBus';

/**
 * WizPlayground — page-level free-roaming Wiz.
 *
 * Renders a small Wiz at the bottom of the viewport that walks to specific
 * targets in response to events from the conversation engine:
 *
 *   - User opens Ask Wiz       → Wiz walks toward the panel
 *   - LLM working               → Wiz stays put, in 'working' state
 *   - Chart was just built      → Wiz walks to the chart and points at it
 *   - Error                     → Wiz scratches head ('confused')
 *   - Panel closed / long idle  → Wiz walks back to his parking spot
 *
 * The playground is deliberately optional. Set `enabled={false}` and Wiz
 * stays inside the panel only. We keep the mascot inside the panel as well
 * so users with cluttered viewports don't have a Wiz wandering across
 * everything by default.
 */

const PARK_X = 24;       // px from the left edge of the viewport
const PARK_Y = 24;       // px from the bottom of the viewport
const SIZE = 96;
const WALK_SPEED = 350;  // px per second — slow, deliberate walk

export default function WizPlayground({ enabled = false }) {
  const [state, setState] = useState('idle');
  const [pos, setPos] = useState({ x: PARK_X, y: PARK_Y });
  const [target, setTarget] = useState(null);   // { x, y, label? }
  const [bubble, setBubble] = useState(null);
  const [walkTransition, setWalkTransition] = useState({ duration: 0.6 });
  const [facing, setFacing] = useState('right');     // 'left' | 'right'
  const [castTarget, setCastTarget] = useState(null); // {x, y} in viewBox coords

  const stateTimerRef = useRef(null);
  const bubbleTimerRef = useRef(null);

  // Schedule a state change that auto-reverts after `ms`
  const briefState = useCallback((next, ms) => {
    if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
    setState(next);
    stateTimerRef.current = setTimeout(() => setState('idle'), ms);
  }, []);

  // Show a speech bubble for a short while
  const sayBriefly = useCallback((text, ms = 2200) => {
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    setBubble(text);
    bubbleTimerRef.current = setTimeout(() => setBubble(null), ms);
  }, []);

  // Walk toward a target on screen. After the walk completes, optionally
  // run a follow-up (e.g. point at the chart, then walk back).
  const walkTo = useCallback((nextX, nextY, onArrive) => {
    setTarget({ x: nextX, y: nextY });
    setState('walking');

    // Walk speed scales with distance so all walks feel even-paced
    const dx = nextX - pos.x;
    const dy = nextY - pos.y;
    const dist = Math.hypot(dx, dy);
    const duration = Math.max(0.4, dist / WALK_SPEED);
    setWalkTransition({ duration });

    // Face direction of travel — only flip if there's meaningful horizontal motion
    if (Math.abs(dx) > 4) setFacing(dx > 0 ? 'right' : 'left');

    // After the animation completes, run the follow-up
    setTimeout(() => {
      setPos({ x: nextX, y: nextY });
      setState('idle');
      setTarget(null);
      if (onArrive) onArrive();
    }, duration * 1000 + 50);
  }, [pos]);

  // Walk back to the parking spot
  const walkHome = useCallback(() => {
    walkTo(PARK_X, PARK_Y);
  }, [walkTo]);

  // Subscribe to the Wiz event bus
  useEffect(() => {
    if (!enabled) return undefined;

    const unsubscribe = onWizCue(({ cue, data }) => {
      switch (cue) {
        case CUES.PANEL_OPENED: {
          // Walk to the right side of the viewport, then look up at the panel
          const targetX = window.innerWidth - 200;
          walkTo(targetX, PARK_Y + 30);
          break;
        }

        case CUES.PANEL_CLOSED: {
          walkHome();
          break;
        }

        case CUES.THINKING: {
          // Rapid bobbing in place
          briefState('working', 30 * 1000);
          sayBriefly('Hmm, let me think...', 2500);
          break;
        }

        case CUES.CHART_BUILT:
        case CUES.CHART_UPDATED: {
          // Walk to the chart, then cast magic at it (with particle stream
          // flowing from wand tip toward the chart center)
          const chartEl = document.querySelector('[data-wiz-chart]');
          if (chartEl) {
            const rect = chartEl.getBoundingClientRect();
            // Position Wiz just below the chart, at the left side, facing the chart
            const cx = rect.left + 40;
            const cy = window.innerHeight - rect.bottom + 40;
            walkTo(cx, Math.max(20, cy), () => {
              // Switch to casting and aim particles at the chart center.
              // Cast target is in screen coords; we'll convert to Wiz's local
              // SVG space inside the mascot's render.
              setState('casting');
              const wizCenterScreenX = cx + SIZE / 2;
              const wizCenterScreenY = window.innerHeight - cy - SIZE * 0.5;
              const targetScreenX = rect.left + rect.width / 2;
              const targetScreenY = rect.top + rect.height / 2;
              const scale = 200 / SIZE;  // viewBox units per pixel
              setCastTarget({
                x: 165 + (targetScreenX - wizCenterScreenX) * scale,
                y: 65 + (targetScreenY - wizCenterScreenY) * scale,
              });
              sayBriefly(cue === CUES.CHART_BUILT ? "There we go!" : "Updated!", 2000);
              // After 1.8s of casting, briefly celebrate, then walk home
              setTimeout(() => {
                setCastTarget(null);
                briefState('celebrating', 1200);
                setTimeout(walkHome, 1300);
              }, 1800);
            });
          } else {
            // No chart on screen — just celebrate in place
            briefState('celebrating', 1500);
            sayBriefly('Done!', 2000);
          }
          break;
        }

        case CUES.ERROR: {
          briefState('confused', 3000);
          sayBriefly("Hmm, that didn't work...", 3000);
          break;
        }

        default:
          break;
      }
    });

    return () => {
      unsubscribe();
      if (stateTimerRef.current) clearTimeout(stateTimerRef.current);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    };
  }, [enabled, walkTo, walkHome, briefState, sayBriefly]);

  // Idle wanderlust — every 30-60s of idle time, Wiz takes a few steps in a
  // random direction and comes back. Keeps the page alive without being
  // distracting.
  useEffect(() => {
    if (!enabled) return undefined;
    const interval = setInterval(() => {
      if (state !== 'idle') return;
      const sign = Math.random() > 0.5 ? 1 : -1;
      const offset = sign * (40 + Math.random() * 80);
      const nextX = Math.max(20, Math.min(window.innerWidth - 120, pos.x + offset));
      walkTo(nextX, pos.y, () => {
        // Hang out for a moment, then home
        setTimeout(walkHome, 1500 + Math.random() * 2000);
      });
    }, 35000 + Math.random() * 25000);
    return () => clearInterval(interval);
  }, [enabled, state, pos, walkTo, walkHome]);

  if (!enabled) return null;

  return (
    <motion.div
      animate={{ left: pos.x, bottom: pos.y }}
      transition={target ? { ...walkTransition, ease: 'linear' } : { duration: 0.4 }}
      style={{
        position: 'fixed',
        zIndex: 30,                    // above content, below modals (z-50+)
        pointerEvents: 'none',         // don't block interactions
        left: pos.x,
        bottom: pos.y,
      }}
    >
      <div className="relative">
        <WizMascot
          state={state}
          size={SIZE}
          message={bubble}
          direction={facing}
          castTarget={castTarget}
        />
        {/* Tiny dust puff under feet when walking */}
        <AnimatePresence>
          {state === 'walking' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.3, x: 0 }}
              animate={{ opacity: [0, 0.4, 0], scale: [0.3, 1.4, 0.6], x: [-8, -16, -22] }}
              transition={{ duration: 0.7, repeat: Infinity }}
              style={{
                position: 'absolute',
                left: SIZE / 2 - 5,
                bottom: 4,
                width: 14,
                height: 6,
                borderRadius: '50%',
                background: 'rgba(150, 130, 110, 0.4)',
                filter: 'blur(2px)',
              }}
            />
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
