/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        wiz: {
          // ─── Surfaces ─────────────────────────────────────────────────────
          // Warmer dark — moves from cold blue-black to ink-like, paper-feeling.
          // Off-black with warm undertone is more memorable than pure-blue dark.
          bg: '#0A0908',                  // warm ink (page background)
          surface: '#15130F',             // card base
          card: '#1A1813',                // elevated card
          elevated: '#221F19',            // modal / topmost
          border: '#2A2620',              // hairline borders
          'border-light': '#3D3830',      // hover-border
          'border-strong': '#5C5446',     // emphasis borders

          // ─── Primary accent — warm amber gold ─────────────────────────────
          // The app's voice. Used confidently, not constantly.
          accent: '#E9A521',              // primary action, text emphasis
          'accent-deep': '#C7861A',       // hover, pressed
          'accent-light': '#F5C45E',      // text on dark bg
          'accent-glow': 'rgba(233,165,33,0.14)',
          'accent-soft': 'rgba(233,165,33,0.08)',

          // ─── Secondary — deep teal (matches Wiz's jacket) ─────────────────
          teal: '#3FA89E',
          'teal-deep': '#2D7E76',
          'teal-light': '#7BC4BC',

          // ─── Semantic — used sparingly ────────────────────────────────────
          success: '#7DAD52',             // forest green, not Pantone-bright
          warning: '#D88E3C',             // burnt orange (sibling to amber)
          danger: '#C8553D',              // rusty red, not stoplight red
          info: '#6E8FB5',                // muted slate-blue

          // ─── Type ─────────────────────────────────────────────────────────
          text: '#F0EDE6',                // warm cream — easier on eyes than #FFFFFF
          'text-secondary': '#C4BFB3',
          'text-tertiary': '#8B8579',
          tertiary: '#8B8579',            // shorthand alias
          muted: '#605B51',
          dim: '#4A463E',
          faint: '#332F28',

          // ─── Legacy aliases — keep existing pages working during transition
          // These remap old color names to the new palette so nothing crashes.
          emerald: '#7DAD52',
          'emerald-deep': '#5E8A3C',
          amber: '#E9A521',
          'amber-deep': '#C7861A',
          rose: '#C8553D',
          'rose-deep': '#A4422F',
          sky: '#6E8FB5',
          'sky-deep': '#5A789A',
          violet: '#9C7FA8',
        },
      },

      fontFamily: {
        // Two faces. Display is an editorial serif (distinctive). Body is Inter (neutral).
        display: ['Fraunces', 'Georgia', 'serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },

      fontSize: {
        '2xs': '0.6875rem',    // 11px — labels only
        'xs': '0.75rem',       // 12px — secondary
        'sm': '0.875rem',      // 14px — UI default
        'base': '1rem',        // 16px — body
        'lg': '1.125rem',      // 18px — subheading
        'xl': '1.375rem',      // 22px — h3
        '2xl': '1.75rem',      // 28px — h2
        '3xl': '2.25rem',      // 36px — h1
        '4xl': '3rem',         // 48px — hero
        '5xl': '4rem',         // 64px — display
      },

      letterSpacing: {
        'tightest': '-0.04em',
        'tight': '-0.02em',
        'snug': '-0.01em',
      },

      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        // Subtle warm light from top-left, like a window
        'paper': 'radial-gradient(ellipse 80% 60% at 20% 0%, rgba(233,165,33,0.05) 0%, transparent 60%)',
      },

      boxShadow: {
        'paper': '0 1px 2px rgba(0,0,0,0.4), 0 1px 1px rgba(0,0,0,0.2)',
        'lift': '0 4px 12px rgba(0,0,0,0.45), 0 2px 4px rgba(0,0,0,0.3)',
        'lift-lg': '0 12px 32px rgba(0,0,0,0.55), 0 4px 12px rgba(0,0,0,0.3)',
        'inner-paper': 'inset 0 1px 0 rgba(255,255,255,0.04)',
        'glow-accent': '0 0 0 3px rgba(233,165,33,0.18)',
      },

      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-soft': 'pulseSoft 3s ease-in-out infinite',
        'slide-up': 'slideUp 0.5s cubic-bezier(0.16,1,0.3,1)',
        'slide-down': 'slideDown 0.4s cubic-bezier(0.16,1,0.3,1)',
        'fade-in': 'fadeIn 0.4s ease-out',
        'lift-in': 'liftIn 0.5s cubic-bezier(0.16,1,0.3,1)',
      },
      keyframes: {
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-8px)' } },
        pulseSoft: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.7' } },
        slideUp: { '0%': { opacity: '0', transform: 'translateY(16px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideDown: { '0%': { opacity: '0', transform: 'translateY(-12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        liftIn: { '0%': { opacity: '0', transform: 'translateY(8px) scale(0.98)' }, '100%': { opacity: '1', transform: 'translateY(0) scale(1)' } },
      },
    },
  },
  plugins: [],
};
