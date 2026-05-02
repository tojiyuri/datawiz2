import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import WizMascot from './WizMascot';

/**
 * FloatingWiz — the coordinate-aware overlay version of WizMascot.
 *
 * This is what makes Wiz feel alive across the workspace. He's positioned
 * absolutely on a parent container and can:
 *
 *   - Walk to a target (x, y) coordinate
 *   - Stop and point at things
 *   - Cast spells with particles toward a target
 *   - Return home (back to where he started)
 *
 * Usage:
 *   <FloatingWiz
 *     parentRef={containerRef}      // walks within this element's bounds
 *     scenario={scenario}            // an array of "beats" defining what Wiz does
 *     onComplete={() => ...}         // fires when the scenario finishes
 *   />
 *
 * A scenario looks like:
 *   [
 *     { type: 'walk', x: 0.5, y: 0.5, duration: 1500 },   // 50%/50% of parent
 *     { type: 'point', direction: 'right', duration: 2000 },
 *     { type: 'cast', target: { x: 100, y: 100 }, duration: 1500 },  // viewport coords
 *     { type: 'walk', x: 'home', y: 'home', duration: 1000 },
 *     { type: 'fade-out' },
 *   ]
 *
 * Coordinates can be:
 *   - Number 0-1: fraction of parent dimension (responsive)
 *   - 'home': original position
 *   - Negative pixel values: from right/bottom edge
 *
 * Wiz starts hidden until the first scenario is given. He fades back out
 * when the scenario completes (unless the last beat is 'idle' which holds him).
 */

export default function FloatingWiz({ parentRef, scenario, onComplete, size = 80 }) {
  const [position, setPosition] = useState(null);     // { x, y } in pixels
  const [direction, setDirection] = useState('right');
  const [state, setState] = useState('idle');
  const [castTarget, setCastTarget] = useState(null);
  const [visible, setVisible] = useState(false);
  const [bubble, setBubble] = useState(null);

  const homeRef = useRef(null);                        // where Wiz started
  const stepIndexRef = useRef(0);
  const stepTimerRef = useRef(null);
  const onCompleteRef = useRef(onComplete);

  // Keep onComplete callback fresh without retriggering effect
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Resolve a scenario coordinate to a pixel value
  const resolveCoord = (val, isX, parentRect) => {
    if (val === 'home') {
      return isX ? homeRef.current?.x ?? 0 : homeRef.current?.y ?? 0;
    }
    if (typeof val === 'number') {
      // 0-1: fraction of parent. Otherwise treat as absolute pixels.
      if (val >= 0 && val <= 1) {
        return isX ? val * parentRect.width : val * parentRect.height;
      }
      // Negative: from far edge
      if (val < 0) {
        return isX ? parentRect.width + val : parentRect.height + val;
      }
      return val;
    }
    return 0;
  };

  // Run the scenario when it changes
  useEffect(() => {
    if (!scenario || !scenario.length || !parentRef?.current) {
      // Cleanup any in-flight scenario
      clearTimeout(stepTimerRef.current);
      setVisible(false);
      return;
    }

    const parentRect = parentRef.current.getBoundingClientRect();

    // Set home to starting position if not yet set
    if (!homeRef.current) {
      // Default home: bottom-right corner of parent
      homeRef.current = {
        x: parentRect.width - size - 16,
        y: parentRect.height - size - 16,
      };
    }

    // Initial position: home
    if (!position) setPosition(homeRef.current);

    setVisible(true);
    stepIndexRef.current = 0;

    const runStep = () => {
      const beat = scenario[stepIndexRef.current];
      if (!beat) {
        // Scenario done
        setVisible(false);
        if (onCompleteRef.current) onCompleteRef.current();
        return;
      }

      const advance = (delay) => {
        stepTimerRef.current = setTimeout(() => {
          stepIndexRef.current++;
          runStep();
        }, delay);
      };

      const rect = parentRef.current?.getBoundingClientRect() || parentRect;

      switch (beat.type) {
        case 'walk': {
          const targetX = resolveCoord(beat.x, true, rect);
          const targetY = resolveCoord(beat.y, false, rect);
          // Face direction of travel
          if (position) {
            setDirection(targetX > position.x ? 'right' : 'left');
          }
          setState('walking');
          setBubble(beat.message || null);
          setPosition({ x: targetX, y: targetY });
          advance(beat.duration ?? 1200);
          break;
        }
        case 'point': {
          if (beat.direction) setDirection(beat.direction);
          setState('pointing');
          setBubble(beat.message || null);
          advance(beat.duration ?? 1500);
          break;
        }
        case 'cast': {
          if (beat.direction) setDirection(beat.direction);
          // Cast target is in screen coords (e.g. a chart bar). We translate
          // it to Wiz's local SVG space (0-200 viewBox). We assume Wiz's
          // wand tip is at viewBox (165, 65) and the target should be the
          // delta from there in viewBox units.
          if (beat.target && position) {
            // Wiz's centre in screen pixels:
            const wizScreenX = position.x + size / 2;
            const wizScreenY = position.y + size * 0.5;
            // Vector from Wiz to target, in pixels:
            const dx = beat.target.x - wizScreenX;
            const dy = beat.target.y - wizScreenY;
            // Convert to viewBox space (200 viewBox units = `size` pixels):
            const scale = 200 / size;
            setCastTarget({
              x: 165 + dx * scale,
              y: 65 + dy * scale,
            });
          } else {
            setCastTarget(null);
          }
          setState('casting');
          setBubble(beat.message || null);
          advance(beat.duration ?? 1800);
          break;
        }
        case 'idle': {
          setState('idle');
          setCastTarget(null);
          setBubble(beat.message || null);
          advance(beat.duration ?? 800);
          break;
        }
        case 'celebrate': {
          setState('celebrating');
          setCastTarget(null);
          setBubble(beat.message || null);
          advance(beat.duration ?? 1800);
          break;
        }
        case 'fade-out': {
          setVisible(false);
          stepTimerRef.current = setTimeout(() => {
            stepIndexRef.current++;
            runStep();
          }, 400);
          break;
        }
        default:
          advance(0);
      }
    };

    runStep();

    return () => clearTimeout(stepTimerRef.current);
  }, [scenario, parentRef, size]);

  if (!position) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{
            opacity: 1,
            scale: 1,
            x: position.x,
            y: position.y,
          }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{
            opacity: { duration: 0.4 },
            scale: { duration: 0.4 },
            x: { type: 'tween', duration: state === 'walking' ? 1.2 : 0.4, ease: 'easeInOut' },
            y: { type: 'tween', duration: state === 'walking' ? 1.2 : 0.4, ease: 'easeInOut' },
          }}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 30,
            pointerEvents: 'none',
            width: size,
            height: size * 1.1,
          }}
        >
          <WizMascot
            state={state}
            size={size}
            direction={direction}
            castTarget={castTarget}
            message={bubble}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Build a "I'll show you the result" scenario — Wiz walks to the chart area,
 * points at the highest bar (or whatever target you give), then walks home.
 *
 * @param targetEl  the DOM element to point at (e.g. a chart bar)
 * @param parentRect  parent's bounding rect (for relative positioning)
 */
export function buildPointAtScenario({ targetEl, parentRect, message }) {
  if (!targetEl || !parentRect) return [];
  const targetRect = targetEl.getBoundingClientRect();
  // Target centre relative to the parent
  const tx = targetRect.left + targetRect.width / 2 - parentRect.left;
  const ty = targetRect.top + targetRect.height / 2 - parentRect.top;

  // Walk to a spot just to the left of the target, leaving room for the wand
  const wizPad = 80;       // size + a bit of padding
  const standX = Math.max(20, tx - wizPad);
  const standY = Math.max(20, ty - 40);

  return [
    { type: 'walk', x: standX, y: standY, duration: 1400 },
    { type: 'cast', target: { x: targetRect.left + targetRect.width / 2, y: targetRect.top }, duration: 1800, message },
    { type: 'idle', duration: 600 },
    { type: 'walk', x: 'home', y: 'home', duration: 1200 },
    { type: 'fade-out' },
  ];
}
