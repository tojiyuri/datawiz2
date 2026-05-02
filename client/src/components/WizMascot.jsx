import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Wiz — the data viz mascot.
 *
 * A full-body SVG character with state-driven animation. Wiz has:
 *   - Curly brown hair, brown skin, glasses (matching the project's aesthetic)
 *   - A friendly outfit: dark teal jacket, neutral shirt
 *   - Magic wand (because, well, Wiz)
 *
 * States: idle | thinking | working | celebrating | confused | speaking | sleeping
 *
 * Each state has different limb/face/wand animations driven by framer-motion.
 * Idle has a gentle breathing + occasional blink. Thinking taps a finger.
 * Working swings the wand and produces sparkle effects. Celebrating jumps.
 *
 * Sized via the `size` prop (default 120). Pure CSS — no images, no deps
 * beyond framer-motion.
 */

const SKIN = '#A57E5E';
const SKIN_DARK = '#8B6346';
const HAIR = '#3F2A1F';
const HAIR_HIGHLIGHT = '#5A3D2E';
const SHIRT = '#E5DDD2';
const JACKET = '#2D5F60';
const JACKET_DARK = '#1F4546';
const PANTS = '#1F2937';
const SHOES = '#0F172A';
const GLASSES = '#0F172A';
const WAND = '#3F2A1F';
const SPARKLE = '#FBBF24';
const MAGIC_BLUE = '#818CF8';
const MAGIC_GREEN = '#34D399';

export default function WizMascot({ state = 'idle', size = 120, message = null, direction = 'right', castTarget = null }) {
  const [blinking, setBlinking] = useState(false);
  // Saccade — momentary eye dart. (-1, 0) = left, (1, 0) = right, (0, -1) = up, (0, 1) = down
  const [saccade, setSaccade] = useState({ x: 0, y: 0 });
  // Yawn — short idle micro-animation: eyes close, mouth opens, body stretches
  const [yawning, setYawning] = useState(false);
  // Tracks whether the user is hovering Wiz — affects expression
  const [hovered, setHovered] = useState(false);
  // Cursor-tracking eyes: where the user's pointer is, normalized -1..1 from Wiz's center
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // ─── BLINKING ──────────────────────────────────────────────────────────────
  // Real humans blink every ~3-5s. Sometimes twice in quick succession (~15%).
  // The sleeping state has its own permanent-closed handling, so skip blinks
  // there; otherwise this adds a constant pulse of life.
  useEffect(() => {
    if (state === 'sleeping') return;
    let timeout;
    let mounted = true;
    const scheduleBlink = () => {
      const wait = 2200 + Math.random() * 3800;
      timeout = setTimeout(() => {
        if (!mounted) return;
        setBlinking(true);
        setTimeout(() => {
          if (!mounted) return;
          setBlinking(false);
          // 15% chance of a second blink (~140ms apart) — natural human pattern
          if (Math.random() < 0.15) {
            setTimeout(() => {
              if (!mounted) return;
              setBlinking(true);
              setTimeout(() => mounted && setBlinking(false), 130);
            }, 180);
          }
        }, 130);
        scheduleBlink();
      }, wait);
    };
    scheduleBlink();
    return () => { mounted = false; clearTimeout(timeout); };
  }, [state]);

  // ─── SACCADES ──────────────────────────────────────────────────────────────
  // Eye darts — one of those subconscious animations the brain registers as
  // "alive." Real humans saccade roughly once every 2-4s when not focused on
  // anything in particular. We skip during states with directional eye intent
  // (thinking looks up, casting is focused, etc.).
  useEffect(() => {
    const directionalStates = ['thinking', 'casting', 'sleeping', 'pointing'];
    if (directionalStates.includes(state)) return;
    let timeout;
    let mounted = true;
    const scheduleSaccade = () => {
      const wait = 1800 + Math.random() * 3200;
      timeout = setTimeout(() => {
        if (!mounted) return;
        // Pick a small offset — eyes don't roll, they nudge
        const directions = [
          { x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 },
          { x: -0.7, y: -0.5 }, { x: 0.7, y: -0.5 },
        ];
        const target = directions[Math.floor(Math.random() * directions.length)];
        setSaccade(target);
        // Hold for 280-600ms, then return
        setTimeout(() => {
          if (mounted) setSaccade({ x: 0, y: 0 });
        }, 280 + Math.random() * 320);
        scheduleSaccade();
      }, wait);
    };
    scheduleSaccade();
    return () => { mounted = false; clearTimeout(timeout); };
  }, [state]);

  // ─── YAWN ──────────────────────────────────────────────────────────────────
  // A small idle micro-animation that fires every ~25-50s when truly idle.
  // Eyes close, mouth opens, body stretches up briefly. The kind of detail
  // a casual viewer never consciously notices but nudges the "this feels
  // alive" needle a lot.
  useEffect(() => {
    if (state !== 'idle') return;
    let timeout;
    let mounted = true;
    const scheduleYawn = () => {
      const wait = 25_000 + Math.random() * 25_000;
      timeout = setTimeout(() => {
        if (!mounted) return;
        setYawning(true);
        setTimeout(() => mounted && setYawning(false), 1100);
        scheduleYawn();
      }, wait);
    };
    scheduleYawn();
    return () => { mounted = false; clearTimeout(timeout); };
  }, [state]);

  // ─── CURSOR TRACKING ───────────────────────────────────────────────────────
  // Wiz's eyes track the cursor when the user's pointer is near. Subtle but
  // transformative — makes Wiz feel aware of the user. Only active in
  // states where it makes sense (idle, speaking, pointing... NOT thinking
  // because that's looking up internally).
  useEffect(() => {
    const trackingStates = ['idle', 'speaking', 'pointing', 'walking'];
    if (!trackingStates.includes(state) || !containerRef.current) return;

    const handler = (e) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      // Normalize to roughly -1..1 within ~300px radius. Beyond that, eyes
      // just settle on the most extreme position rather than going further.
      const dx = (e.clientX - cx) / 300;
      const dy = (e.clientY - cy) / 300;
      setGaze({
        x: Math.max(-1, Math.min(1, dx)),
        y: Math.max(-1, Math.min(1, dy)),
      });
    };
    window.addEventListener('mousemove', handler, { passive: true });
    return () => window.removeEventListener('mousemove', handler);
  }, [state]);

  // Whole-body animations vary by state
  const bodyAnim = useMemo(() => {
    switch (state) {
      case 'thinking':
        return { y: [0, -1.5, 0], transition: { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } };
      case 'working':
        return { y: [0, -2, 0, -1, 0], rotate: [0, 0.5, 0, -0.5, 0], transition: { duration: 1.4, repeat: Infinity, ease: 'easeInOut' } };
      case 'walking':
        // Walking gait — pronounced bob
        return { y: [0, -3, 0, -3, 0], transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' } };
      case 'pointing':
        // Slight forward lean while holding the point
        return { y: [0, -1, 0], rotate: [0, 1, 0], transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } };
      case 'casting':
        // Energetic, pulse forward in rhythm with particles
        return { y: [0, -2, 0], rotate: [-1, 2, -1], transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' } };
      case 'celebrating':
        return { y: [0, -8, 0, -8, 0], transition: { duration: 0.6, repeat: 3, ease: 'easeOut' } };
      case 'confused':
        return { rotate: [-2, 2, -2], transition: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' } };
      case 'speaking':
        return { y: [0, -1, 0], transition: { duration: 0.8, repeat: Infinity, ease: 'easeInOut' } };
      case 'sleeping':
        return { rotate: [-1, 1, -1], transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } };
      case 'idle':
      default:
        // Gentle breathing
        return { y: [0, -1, 0], transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' } };
    }
  }, [state]);

  // Wand position varies by state
  const wandAnim = useMemo(() => {
    switch (state) {
      case 'working':
        return { rotate: [-15, 25, -15], transition: { duration: 0.7, repeat: Infinity, ease: 'easeInOut' } };
      case 'celebrating':
        return { rotate: [0, -45, 0, -45, 0], transition: { duration: 0.5, repeat: 3 } };
      case 'thinking':
        return { rotate: [0, 5, 0], transition: { duration: 2, repeat: Infinity } };
      case 'casting':
        // Wand vibrates while channelling magic
        return { rotate: [-5, 5, -5], transition: { duration: 0.25, repeat: Infinity, ease: 'easeInOut' } };
      case 'idle':
      default:
        return { rotate: 0 };
    }
  }, [state]);

  // Right arm position (the one holding the wand)
  const rightArmAnim = useMemo(() => {
    switch (state) {
      case 'working':
        return { rotate: [-10, 20, -10], transition: { duration: 0.7, repeat: Infinity, ease: 'easeInOut' } };
      case 'celebrating':
        return { rotate: [-30, -60, -30], transition: { duration: 0.6, repeat: 3 } };
      case 'speaking':
        return { rotate: [0, -8, 0, 4, 0], transition: { duration: 1.6, repeat: Infinity } };
      case 'walking':
        // Arm swings opposite to right leg
        return { rotate: [0, -12, 0, 18, 0], transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' } };
      case 'pointing':
        // Raise wand up and forward
        return { rotate: -65, transition: { duration: 0.4, ease: 'easeOut' } };
      case 'casting':
        // Wand-arm extends forward, oscillating slightly with magic flow
        return { rotate: [-70, -55, -70], transition: { duration: 0.4, repeat: Infinity, ease: 'easeInOut' } };
      default:
        return { rotate: 0 };
    }
  }, [state]);

  const leftArmAnim = useMemo(() => {
    switch (state) {
      case 'celebrating':
        return { rotate: [30, 60, 30], transition: { duration: 0.6, repeat: 3 } };
      case 'thinking':
        // Hand to chin (handled in transform too)
        return { rotate: [-20, -22, -20], transition: { duration: 2, repeat: Infinity } };
      case 'working':
        return { rotate: [5, -3, 5], transition: { duration: 1.2, repeat: Infinity } };
      case 'walking':
        // Counter-swing the right arm
        return { rotate: [0, 18, 0, -12, 0], transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' } };
      default:
        return { rotate: 0 };
    }
  }, [state]);

  // Mouth shape varies by state, with yawn override and hover sweetening
  const mouthShape = (() => {
    if (yawning) return 'yawn';
    if (hovered && (state === 'idle' || state === 'speaking')) return 'big_smile';
    switch (state) {
      case 'speaking':
      case 'working':
      case 'casting':
        return 'o';      // open
      case 'celebrating':
        return 'big_smile';
      case 'thinking':
      case 'confused':
        return 'small';
      case 'sleeping':
        return 'flat';
      case 'idle':
      default:
        return 'smile';
    }
  })();

  // Eyes vary by state. Yawn closes them. Hover during idle = "happy" (gentle smile).
  const eyeShape = (() => {
    if (blinking || yawning) return 'closed';
    if (state === 'sleeping') return 'closed';
    if (hovered && state === 'idle') return 'happy';
    if (state === 'thinking') return 'looking_up';
    if (state === 'celebrating') return 'happy';
    if (state === 'confused') return 'wide';
    if (state === 'casting') return 'focused';
    return 'open';
  })();

  // Compute the actual pupil offset in SVG units. Saccades take priority
  // over gaze tracking — if Wiz is mid-saccade, the eyes are already moving.
  // Each pupil can only travel ~1.5 SVG units before clipping outside the
  // glasses (which have radius 7).
  const eyeOffset = useMemo(() => {
    const sx = saccade.x, sy = saccade.y;
    const using = Math.abs(sx) + Math.abs(sy) > 0;
    if (using) {
      return { x: sx * 1.6, y: sy * 1.4 };
    }
    return { x: gaze.x * 1.4, y: gaze.y * 1.0 };
  }, [saccade, gaze]);

  // Leg animations — walking gait alternates the legs
  const leftLegAnim = useMemo(() => {
    if (state === 'walking') {
      return {
        rotate: [0, 22, 0, -10, 0],
        transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' },
      };
    }
    return { rotate: 0 };
  }, [state]);

  const rightLegAnim = useMemo(() => {
    if (state === 'walking') {
      return {
        rotate: [0, -10, 0, 22, 0],
        transition: { duration: 0.6, repeat: Infinity, ease: 'easeInOut' },
      };
    }
    return { rotate: 0 };
  }, [state]);

  // Head animation — tilts during thinking/confused, lifts gently during yawn,
  // and tracks gaze with a tiny rotation when hovering. Always smooth.
  const headAnim = useMemo(() => {
    if (yawning) {
      return {
        rotate: [0, -3, -3, 0],
        y: [0, -2, -2, 0],
        transition: { duration: 1.0, ease: 'easeInOut', times: [0, 0.3, 0.7, 1] },
      };
    }
    if (state === 'thinking') {
      return { rotate: [0, 6, 6, 0], transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } };
    }
    if (state === 'confused') {
      return { rotate: [-4, 4, -4], transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } };
    }
    if (state === 'celebrating') {
      return { rotate: [0, -8, 8, 0], transition: { duration: 0.8, repeat: 3, ease: 'easeInOut' } };
    }
    if (state === 'sleeping') {
      return { rotate: [12, 14, 12], transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } };
    }
    // Default: a tiny gaze-following head turn — way subtler than the eye gaze
    return {
      rotate: gaze.x * 1.2,
      transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] },
    };
  }, [state, yawning, gaze.x]);

  // Chest "breathing" — independent of body bob. The torso scales vertically
  // by ~1% on a slow cycle. Adds a layer of life beneath the body bob.
  const breathingAnim = useMemo(() => {
    if (state === 'sleeping') {
      // Deeper, slower breaths
      return { scaleY: [1, 1.025, 1], transition: { duration: 4, repeat: Infinity, ease: 'easeInOut' } };
    }
    if (state === 'idle' || state === 'speaking' || state === 'pointing') {
      return { scaleY: [1, 1.012, 1], transition: { duration: 3.4, repeat: Infinity, ease: 'easeInOut' } };
    }
    return { scaleY: 1 };
  }, [state]);

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ width: size, height: size }}
      className="relative inline-block flex-shrink-0 select-none cursor-default"
    >
      <motion.svg
        viewBox="0 0 200 220"
        width={size}
        height={size * 1.1}
        animate={bodyAnim}
        style={{ overflow: 'visible' }}
      >
        {/* Direction wrapper — flip horizontally when facing left */}
        <g style={{
          transform: direction === 'left' ? 'scaleX(-1)' : 'none',
          transformOrigin: '100px 110px',
          transformBox: 'view-box',
        }}>
        {/* ─── SHADOW ────────────────────────────────────────── */}
        <ellipse cx="100" cy="210" rx="40" ry="4" fill="rgba(0,0,0,0.25)" />

        {/* ─── LEFT LEG ──────────────────────────────────────── */}
        <motion.g animate={leftLegAnim} style={{ transformOrigin: '91px 170px', transformBox: 'fill-box' }}>
          <rect x="85" y="170" width="12" height="35" rx="4" fill={PANTS} />
          <ellipse cx="91" cy="207" rx="9" ry="3.5" fill={SHOES} />
        </motion.g>

        {/* ─── RIGHT LEG ─────────────────────────────────────── */}
        <motion.g animate={rightLegAnim} style={{ transformOrigin: '109px 170px', transformBox: 'fill-box' }}>
          <rect x="103" y="170" width="12" height="35" rx="4" fill={PANTS} />
          <ellipse cx="109" cy="207" rx="9" ry="3.5" fill={SHOES} />
        </motion.g>

        {/* ─── TORSO (jacket) ────────────────────────────────── */}
        <motion.g
          animate={breathingAnim}
          style={{ transformOrigin: '100px 175px', transformBox: 'view-box' }}
        >
          {/* Jacket body */}
          <path
            d="M 75 110 Q 70 115 70 130 L 72 175 Q 72 178 76 178 L 124 178 Q 128 178 128 175 L 130 130 Q 130 115 125 110 Z"
            fill={JACKET}
          />
          {/* Jacket shadow / depth */}
          <path
            d="M 100 110 L 100 178 L 124 178 Q 128 178 128 175 L 130 130 Q 130 115 125 110 Z"
            fill={JACKET_DARK}
            opacity="0.35"
          />
          {/* Shirt collar peek */}
          <path
            d="M 90 110 L 100 120 L 110 110 L 105 115 L 100 122 L 95 115 Z"
            fill={SHIRT}
          />
          {/* Shirt V */}
          <path
            d="M 92 113 L 100 128 L 108 113 Z"
            fill={SHIRT}
          />
          {/* Jacket button */}
          <circle cx="100" cy="148" r="1.8" fill={JACKET_DARK} />
          <circle cx="100" cy="160" r="1.8" fill={JACKET_DARK} />
        </motion.g>

        {/* ─── LEFT ARM ──────────────────────────────────────── */}
        <motion.g
          style={{ originX: '78px', originY: '115px' }}
          animate={leftArmAnim}
        >
          <rect x="65" y="113" width="13" height="40" rx="6" fill={JACKET} />
          {state === 'thinking' ? (
            // Hand reaching up to chin
            <g transform="translate(70, 95)">
              <circle cx="0" cy="0" r="6" fill={SKIN} />
              <circle cx="0" cy="0" r="6" fill={SKIN_DARK} opacity="0.2" />
            </g>
          ) : (
            <circle cx="71" cy="156" r="6" fill={SKIN} />
          )}
        </motion.g>

        {/* ─── RIGHT ARM (holds wand) ────────────────────────── */}
        <motion.g
          style={{ originX: '125px', originY: '115px' }}
          animate={rightArmAnim}
        >
          <rect x="122" y="113" width="13" height="40" rx="6" fill={JACKET} />
          <circle cx="129" cy="156" r="6" fill={SKIN} />

          {/* The wand! */}
          <motion.g
            style={{ originX: '129px', originY: '156px' }}
            animate={wandAnim}
          >
            <line x1="129" y1="156" x2="155" y2="125" stroke={WAND} strokeWidth="2.5" strokeLinecap="round" />
            {/* Wand tip — glowing star */}
            <g transform="translate(155, 125)">
              {/* Always-on faint halo so the wand always looks magical, not dormant */}
              <motion.circle
                cx="0" cy="0"
                fill={SPARKLE}
                opacity="0.18"
                animate={{ r: [4, 5, 4], opacity: [0.15, 0.28, 0.15] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              />
              <motion.circle
                cx="0"
                cy="0"
                r="3.5"
                fill={SPARKLE}
                animate={
                  state === 'working' || state === 'celebrating' || state === 'casting'
                    ? { r: [3.5, 5, 3.5], opacity: [1, 0.8, 1] }
                    : { r: [3.2, 3.6, 3.2] }
                }
                transition={{
                  duration: state === 'casting' ? 0.4 : (state === 'working' || state === 'celebrating') ? 0.6 : 2.0,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
              {(state === 'working' || state === 'celebrating' || state === 'casting') ? (
                <circle cx="0" cy="0" r="6" fill={SPARKLE} opacity="0.3">
                  <animate attributeName="r" values="6;11;6" dur="0.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.3;0;0.3" dur="0.6s" repeatCount="indefinite" />
                </circle>
              ) : null}
            </g>
          </motion.g>
        </motion.g>

        {/* ─── NECK ──────────────────────────────────────────── */}
        <rect x="93" y="103" width="14" height="10" fill={SKIN} />

        {/* ─── HEAD ──────────────────────────────────────────── */}
        <motion.g
          animate={headAnim}
          style={{ transformOrigin: '100px 105px', transformBox: 'view-box' }}
        >
          {/* Face/skin */}
          <ellipse cx="100" cy="80" rx="28" ry="32" fill={SKIN} />

          {/* Side hair (frames the face) */}
          <path
            d="M 72 70 Q 70 50 80 42 Q 75 60 75 80 Q 75 90 78 100 Z"
            fill={HAIR}
          />
          <path
            d="M 128 70 Q 130 50 120 42 Q 125 60 125 80 Q 125 90 122 100 Z"
            fill={HAIR}
          />

          {/* Top hair — curly */}
          <g>
            <ellipse cx="85" cy="48" rx="9" ry="11" fill={HAIR} />
            <ellipse cx="100" cy="42" rx="11" ry="13" fill={HAIR} />
            <ellipse cx="115" cy="48" rx="9" ry="11" fill={HAIR} />
            <ellipse cx="92" cy="55" rx="6" ry="7" fill={HAIR_HIGHLIGHT} opacity="0.7" />
            <ellipse cx="108" cy="55" rx="6" ry="7" fill={HAIR_HIGHLIGHT} opacity="0.7" />
            <ellipse cx="100" cy="50" rx="5" ry="6" fill={HAIR_HIGHLIGHT} opacity="0.5" />
            {/* Curl tendrils */}
            <circle cx="78" cy="58" r="3.5" fill={HAIR} />
            <circle cx="122" cy="58" r="3.5" fill={HAIR} />
            <circle cx="80" cy="65" r="2.5" fill={HAIR} />
            <circle cx="120" cy="65" r="2.5" fill={HAIR} />
          </g>

          {/* Glasses */}
          <g stroke={GLASSES} strokeWidth="1.8" fill="rgba(255,255,255,0.05)">
            <circle cx="89" cy="80" r="7" />
            <circle cx="111" cy="80" r="7" />
            <line x1="96" y1="80" x2="104" y2="80" />
            <line x1="82" y1="78" x2="78" y2="76" />
            <line x1="118" y1="78" x2="122" y2="76" />
          </g>

          {/* Eyes — render based on state */}
          <g>
            {eyeShape === 'closed' && (
              <>
                <path d="M 86 81 Q 89 83 92 81" stroke={GLASSES} strokeWidth="1.5" fill="none" strokeLinecap="round" />
                <path d="M 108 81 Q 111 83 114 81" stroke={GLASSES} strokeWidth="1.5" fill="none" strokeLinecap="round" />
              </>
            )}
            {eyeShape === 'open' && (
              <motion.g
                animate={{ x: eyeOffset.x, y: eyeOffset.y }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <circle cx="89" cy="80" r="1.6" fill={GLASSES} />
                <circle cx="111" cy="80" r="1.6" fill={GLASSES} />
                <circle cx="89.5" cy="79.5" r="0.5" fill="white" />
                <circle cx="111.5" cy="79.5" r="0.5" fill="white" />
              </motion.g>
            )}
            {eyeShape === 'looking_up' && (
              <motion.g
                animate={{ y: [-2, -2.4, -2] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              >
                <circle cx="89" cy="80" r="1.6" fill={GLASSES} />
                <circle cx="111" cy="80" r="1.6" fill={GLASSES} />
              </motion.g>
            )}
            {eyeShape === 'happy' && (
              <>
                <path d="M 86 81 Q 89 78 92 81" stroke={GLASSES} strokeWidth="1.8" fill="none" strokeLinecap="round" />
                <path d="M 108 81 Q 111 78 114 81" stroke={GLASSES} strokeWidth="1.8" fill="none" strokeLinecap="round" />
              </>
            )}
            {eyeShape === 'wide' && (
              <motion.g
                animate={{ x: eyeOffset.x * 0.5, y: eyeOffset.y * 0.5 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                <circle cx="89" cy="80" r="2.2" fill={GLASSES} />
                <circle cx="111" cy="80" r="2.2" fill={GLASSES} />
                <circle cx="89.7" cy="79.3" r="0.7" fill="white" />
                <circle cx="111.7" cy="79.3" r="0.7" fill="white" />
              </motion.g>
            )}
            {eyeShape === 'focused' && (
              <>
                {/* Narrowed determined eyes — shorter horizontal lines */}
                <line x1="86" y1="81" x2="92" y2="81" stroke={GLASSES} strokeWidth="1.8" strokeLinecap="round" />
                <line x1="108" y1="81" x2="114" y2="81" stroke={GLASSES} strokeWidth="1.8" strokeLinecap="round" />
                <circle cx="89" cy="80.5" r="1" fill={GLASSES} />
                <circle cx="111" cy="80.5" r="1" fill={GLASSES} />
              </>
            )}
          </g>

          {/* Mouth */}
          <g>
            {mouthShape === 'smile' && (
              <path d="M 93 92 Q 100 96 107 92" stroke={GLASSES} strokeWidth="1.6" fill="none" strokeLinecap="round" />
            )}
            {mouthShape === 'big_smile' && (
              <path d="M 91 91 Q 100 99 109 91" stroke={GLASSES} strokeWidth="1.8" fill={SKIN_DARK} strokeLinecap="round" />
            )}
            {mouthShape === 'small' && (
              <line x1="96" y1="93" x2="104" y2="93" stroke={GLASSES} strokeWidth="1.6" strokeLinecap="round" />
            )}
            {mouthShape === 'o' && (
              <motion.ellipse
                cx="100" cy="93" rx="2.5" ry="2.5"
                fill={SKIN_DARK}
                animate={{ ry: [2.5, 1.2, 2.5] }}
                transition={{ duration: 0.4, repeat: Infinity }}
              />
            )}
            {mouthShape === 'flat' && (
              <line x1="95" y1="93" x2="105" y2="93" stroke={GLASSES} strokeWidth="1.4" strokeLinecap="round" />
            )}
            {mouthShape === 'yawn' && (
              <motion.ellipse
                cx="100" cy="94"
                fill={SKIN_DARK}
                initial={{ rx: 1, ry: 1 }}
                animate={{ rx: [1, 4, 4, 1], ry: [1, 5, 5, 1] }}
                transition={{ duration: 1.0, ease: 'easeInOut', times: [0, 0.3, 0.7, 1] }}
              />
            )}
          </g>

          {/* Cheek blush — only when celebrating */}
          {state === 'celebrating' && (
            <>
              <ellipse cx="80" cy="88" rx="4" ry="2" fill="#FB7185" opacity="0.4" />
              <ellipse cx="120" cy="88" rx="4" ry="2" fill="#FB7185" opacity="0.4" />
            </>
          )}
        </motion.g>

        {/* ─── MAGIC EFFECTS ─────────────────────────────────── */}
        <AnimatePresence>
          {state === 'working' && (
            <g>
              {[...Array(5)].map((_, i) => (
                <motion.circle
                  key={i}
                  initial={{ cx: 155, cy: 125, opacity: 0, r: 1 }}
                  animate={{
                    cx: 155 + (Math.cos(i * 1.3) * 30),
                    cy: 125 + (Math.sin(i * 1.3) * 30) - 20,
                    opacity: [0, 1, 0],
                    r: [1, 3, 1],
                  }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: i * 0.18,
                  }}
                  fill={[SPARKLE, MAGIC_BLUE, MAGIC_GREEN, SPARKLE, MAGIC_BLUE][i]}
                />
              ))}
            </g>
          )}
          {state === 'celebrating' && (
            <g>
              {[...Array(8)].map((_, i) => (
                <motion.text
                  key={i}
                  initial={{
                    x: 100,
                    y: 80,
                    opacity: 1,
                    scale: 0.4,
                  }}
                  animate={{
                    x: 100 + (Math.cos(i * 0.78) * 70),
                    y: 80 + (Math.sin(i * 0.78) * 70) - 30,
                    opacity: 0,
                    scale: 1,
                  }}
                  transition={{
                    duration: 1.2,
                    delay: i * 0.04,
                  }}
                  fontSize="18"
                  fill={[SPARKLE, MAGIC_BLUE, MAGIC_GREEN, '#FB7185'][i % 4]}
                  textAnchor="middle"
                >
                  ✦
                </motion.text>
              ))}
            </g>
          )}
          {state === 'pointing' && (
            // Sparkle trail flowing outward from the wand tip toward the chart
            // (the tip sits roughly at SVG x=160, y=70 when the arm rotates -65°).
            <g>
              {[...Array(6)].map((_, i) => (
                <motion.text
                  key={`point-${i}`}
                  initial={{ x: 160, y: 70, opacity: 0, scale: 0.4 }}
                  animate={{
                    x: 160 + 60,           // streams outward to the right
                    y: 70 - 10,
                    opacity: [0, 1, 1, 0],
                    scale: [0.4, 0.9, 0.9, 0.5],
                  }}
                  transition={{
                    duration: 1.2,
                    delay: i * 0.18,
                    repeat: Infinity,
                  }}
                  fontSize="14"
                  fill={[SPARKLE, MAGIC_BLUE, MAGIC_GREEN][i % 3]}
                  textAnchor="middle"
                >
                  ✦
                </motion.text>
              ))}
            </g>
          )}
          {state === 'casting' && (
            // Continuous magic stream from wand tip (≈x=165, y=65) toward
            // castTarget if provided, else a generic forward arc. Heavier
            // particle density than 'pointing' — this is a live casting effect.
            <g>
              {[...Array(12)].map((_, i) => {
                const targetX = castTarget?.x ?? 165 + 80;
                const targetY = castTarget?.y ?? 50;
                return (
                  <motion.circle
                    key={`cast-${i}`}
                    initial={{ cx: 165, cy: 65, opacity: 0, r: 1 }}
                    animate={{
                      cx: targetX,
                      cy: targetY,
                      opacity: [0, 1, 1, 0],
                      r: [1, 3, 2.5, 0.5],
                    }}
                    transition={{
                      duration: 0.9,
                      delay: i * 0.08,
                      repeat: Infinity,
                      ease: 'easeOut',
                    }}
                    fill={[SPARKLE, MAGIC_BLUE, MAGIC_GREEN, '#FB7185'][i % 4]}
                  />
                );
              })}
              {/* Main glowing orb at wand tip — pulsing */}
              <motion.circle
                cx="165" cy="65"
                animate={{ r: [3, 6, 3], opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 0.4, repeat: Infinity, ease: 'easeInOut' }}
                fill={SPARKLE}
                style={{ filter: 'blur(0.5px)' }}
              />
            </g>
          )}
          {state === 'thinking' && (
            // Question mark over head
            <motion.text
              x="135"
              y="50"
              fontSize="18"
              fill={MAGIC_BLUE}
              fontWeight="bold"
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: [0, 1, 1, 0], y: [60, 50, 50, 40] }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              ?
            </motion.text>
          )}
          {state === 'sleeping' && (
            <motion.text
              x="135"
              y="60"
              fontSize="14"
              fill={MAGIC_BLUE}
              initial={{ opacity: 0, y: 70, x: 135 }}
              animate={{ opacity: [0, 1, 0], y: [70, 40], x: [135, 145] }}
              transition={{ duration: 2.5, repeat: Infinity }}
            >
              z
            </motion.text>
          )}
        </AnimatePresence>
        </g>
        {/* End direction wrapper */}
      </motion.svg>

      {/* Speech bubble */}
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 10 }}
            transition={{ duration: 0.2 }}
            className="absolute left-full ml-2 top-2 whitespace-nowrap rounded-lg bg-wiz-surface/95 backdrop-blur border border-wiz-accent/30 px-2.5 py-1.5 text-[10px] text-wiz-text shadow-lg pointer-events-none"
            style={{ maxWidth: 220 }}
          >
            <div className="absolute -left-1 top-3 w-2 h-2 bg-wiz-surface/95 border-l border-b border-wiz-accent/30 rotate-45" />
            {message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper: derive Wiz state from conversation activity
export function deriveWizState({ busy, lastIntent, hasError, idleSeconds }) {
  if (hasError) return 'confused';
  if (busy) return 'working';
  if (lastIntent === 'create' || lastIntent === 'change_chart' || lastIntent === 'add_field') {
    return 'celebrating';
  }
  if (lastIntent === 'unclear' || lastIntent === 'error') return 'confused';
  if (idleSeconds > 30) return 'sleeping';
  return 'idle';
}
