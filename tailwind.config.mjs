/** @type {import('tailwindcss').Config} */

/*
 * ZippyZack Design System — Tailwind mirror.
 *
 * The canonical values live in src/styles/tokens/*.css (copied verbatim from the
 * Claude Design project "ZippyZack Design System"). They are repeated here as
 * literals rather than var() references so utilities keep working with opacity
 * modifiers (bg-mint/20, ring-mint-deep/45) — a CSS var holding a hex cannot.
 * When re-syncing tokens, update both.
 *
 * THE RULE THAT BREAKS DESIGNS IF MISSED:
 *   lemon (#FFEB6C) and mint (#21FFA8) are FILLS, NEVER TEXT.
 *   Bright fill -> forest label (text-ink). Dark fill -> cream label (text-paper).
 *   Accent-coloured text -> only the -deep shades (mint-deep, lemon-deep).
 */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // --- The four brand colours -------------------------------------
        lemon: {
          DEFAULT: '#FFEB6C', // fill only
          deep: '#7A5E00', // the readable one
          mid: '#C9A400',
          soft: '#FFF4A6',
          wash: '#FFFBE4',
        },
        mint: {
          DEFAULT: '#21FFA8', // fill only
          deep: '#00695C', // the readable one
          mid: '#00A883',
          soft: '#A8FFDC',
          wash: '#E4FFF3',
          // legacy aliases (pre-rebrand class names still in the pages)
          dark: '#00695C',
          light: '#A8FFDC',
          muted: '#E4FFF3',
        },
        cream: {
          DEFAULT: '#FBF1CA',
          50: '#FFFDF2',
          100: '#FBF1CA', // page ground — never white
          200: '#F5E7B8',
          300: '#EBD9A0', // hairline borders
          400: '#DCC784',
        },
        // The one hot accent, reserved for "featured". Not a fifth brand
        // colour — it exists so ONE thing on a page can outrank lemon and
        // mint. Same rule as the other bright fills: flame is a FILL and
        // takes an ink label (4.8:1); flame-deep is the readable text shade.
        flame: {
          DEFAULT: '#FF7A2E', // fill only
          deep: '#8A3400', // the readable one
          mid: '#D75A00',
          soft: '#FFC6A1',
          wash: '#FFF1E6',
        },
        forest: {
          DEFAULT: '#005247',
          deep: '#003B33',
          mid: '#00695C',
          tint: '#2E6A60',
          soft: '#7FB3AA',
          wash: '#E4F1EE',
        },

        // --- Semantic ----------------------------------------------------
        paper: '#FFFBEA', // card fill, and the label colour on forest
        ink: {
          DEFAULT: '#003B33', // headings
          body: '#005247', // body copy
          muted: '#2E6A60', // captions
          faint: '#7FB3AA', // on-forest muted / hairlines
        },

        // --- Legacy aliases, remapped onto the new palette ---------------
        // Kept so the pre-rebrand pages stay readable; prefer the names above.
        blush: '#FBF1CA',
        sand: '#F5E7B8',
        sky: {
          DEFAULT: '#FFEB6C',
          light: '#FFF4A6',
          dark: '#7A5E00',
          muted: '#FFFBE4',
        },
        neon: {
          DEFAULT: '#FFEB6C',
          light: '#FFF4A6',
          dark: '#C9A400',
          hover: '#FFE23F',
        },
        slate: {
          dark: '#003B33',
          warm: '#005247',
          light: '#2E6A60',
          muted: '#7FB3AA',
        },
        brown: {
          dark: '#003B33',
          warm: '#005247',
          light: '#2E6A60',
        },
        'rose-dust': '#00695C',
        'rose-dark': '#003B33',
        sage: {
          DEFAULT: '#00695C',
          light: '#A8FFDC',
          dark: '#003B33',
        },
      },
      fontFamily: {
        // Baloo 2 is the voice of the brand — every heading and the wordmark.
        display: ['"Baloo 2"', '"Baloo2"', 'ui-rounded', 'system-ui', 'sans-serif'],
        // Newsreader italic: exactly one emphasised word per headline.
        serif: ['"Newsreader"', 'Georgia', '"Times New Roman"', 'serif'],
        sans: ['"Nunito Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Space Mono"', 'ui-monospace', '"SFMono-Regular"', 'monospace'],
      },
      fontSize: {
        'display-1': ['clamp(44px,5.4vw,72px)', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        'display-2': ['clamp(34px,3.8vw,52px)', { lineHeight: '1.08', letterSpacing: '-0.02em' }],
        micro: ['11px', { lineHeight: '1.5' }],
      },
      letterSpacing: {
        eyebrow: '0.16em',
      },
      borderRadius: {
        // Nothing is square. A square-cornered button is a bug.
        field: '14px',
        card: '16px',
        photo: '24px',
        pill: '999px',
      },
      boxShadow: {
        // Soft and wide, never tight and dark.
        xs: '0 1px 2px rgba(62,42,30,.05)',
        sm: '0 1px 3px rgba(62,42,30,.06),0 1px 2px rgba(62,42,30,.04)',
        DEFAULT: '0 4px 14px rgba(62,42,30,.07)',
        md: '0 4px 14px rgba(62,42,30,.07)',
        lg: '0 12px 32px rgba(62,42,30,.10)',
        xl: '0 24px 60px rgba(62,42,30,.14)',
        '2xl': '0 24px 60px rgba(62,42,30,.14)',
        inset: 'inset 0 1px 0 rgba(255,255,255,.6)',
      },
      backgroundImage: {
        // Exactly four gradients, and no others.
        'btn-gradient': 'linear-gradient(135deg,#21FFA8 0%,#8CFAC4 52%,#FFEB6C 100%)',
        'btn-gradient-hover': 'linear-gradient(135deg,#00F09A 0%,#79F5B9 52%,#FFE23F 100%)',
        'hero-wash': 'linear-gradient(180deg,#FBF1CA 0%,#F5E7B8 100%)',
        'dark-wash': 'linear-gradient(160deg,#005247 0%,#003B33 100%)',
        'photo-scrim': 'linear-gradient(180deg,rgba(0,59,49,0) 38%,rgba(0,59,49,.74) 100%)',
        // legacy alias — the old hero gradient is now the hero wash
        'brand-gradient': 'linear-gradient(180deg,#FBF1CA 0%,#F5E7B8 100%)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(.22,.61,.36,1)',
        bounce: 'cubic-bezier(.34,1.56,.64,1)',
        'in-out': 'cubic-bezier(.45,0,.55,1)',
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '320ms',
        lazy: '600ms',
      },
      maxWidth: {
        container: '1200px',
        narrow: '720px',
      },
      keyframes: {
        'zz-bob': {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-5px)' },
        },
        'zz-fade-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        'zz-bob': 'zz-bob 2.4s cubic-bezier(.34,1.56,.64,1) infinite',
        'zz-fade-up': 'zz-fade-up 320ms cubic-bezier(.22,.61,.36,1) both',
      },
    },
  },
  plugins: [],
};
