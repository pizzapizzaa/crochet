/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Core brand tokens
        ink: '#330122', // text primary
        paper: '#FAF5EC', // text secondary (on dark bg / gradient buttons)
        blush: '#FFDDFA', // background solid primary
        sand: '#FFF3DD', // background solid secondary

        // Background surfaces (light -> deep)
        cream: {
          50: '#FFFBF6', // near-white cards
          100: '#FFDDFA', // background solid primary
          200: '#FFF3DD', // background solid secondary
          300: '#F5C9FB', // hairline borders / dividers
        },
        // Magenta - primary accent (from button gradient)
        mint: {
          DEFAULT: '#ED5AEC',
          light: '#F9C8FB',
          dark: '#B81E9C',
          muted: '#FCE4FB',
        },
        // Lavender - secondary accent (gradient tail)
        sky: {
          DEFAULT: '#D555FF',
          light: '#EDB5FF',
          dark: '#8F2BC4',
          muted: '#F5E3FF',
        },
        // CTA fills
        neon: {
          DEFAULT: '#FE64DC',
          light: '#FF8FE7',
          dark: '#E257F6',
          hover: '#ED5AEC',
        },
        // Text colors
        slate: {
          warm: '#63234B',
          dark: '#330122',
          light: '#8C5A7B',
          muted: '#B98FAB',
        },
        // Legacy aliases for easier migration
        'rose-dust': '#B81E9C',
        'rose-dark': '#96157F',
        sage: {
          DEFAULT: '#8F2BC4',
          light: '#EDB5FF',
          dark: '#6E1C9B',
        },
        brown: {
          warm: '#63234B',
          dark: '#330122',
          light: '#8C5A7B',
        },
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'brand-gradient':
          'linear-gradient(to right top, #ffddfa, #fcd3fa, #f9c8fb, #f3bffd, #edb5ff)',
        'btn-gradient':
          'linear-gradient(to right top, #fe64dc, #f75ee4, #ed5aec, #e257f6, #d555ff)',
        'yarn-texture': "url('/textures/yarn-bg.svg')",
      },
    },
  },
  plugins: [],
};
