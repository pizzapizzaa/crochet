/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        // Backgrounds
        cream: {
          50: '#FDFBF7',
          100: '#F8FAFA',
          200: '#EEF4F3',
          300: '#E0EEEC',
        },
        // Pastel green - primary accent
        mint: {
          DEFAULT: '#A8D5BA',
          light: '#C5E6D2',
          dark: '#7BC49A',
          muted: '#D4EBE0',
        },
        // Pastel blue - secondary accent
        sky: {
          DEFAULT: '#A8D4E6',
          light: '#C5E4F0',
          dark: '#7BC0D9',
          muted: '#D4ECF5',
        },
        // Neon yellow - CTAs
        neon: {
          DEFAULT: '#E6FF00',
          light: '#F0FF66',
          dark: '#CCE600',
          hover: '#D4ED00',
        },
        // Text colors
        slate: {
          warm: '#4A5568',
          dark: '#1A202C',
          light: '#718096',
          muted: '#A0AEC0',
        },
        // Legacy aliases for easier migration
        'rose-dust': '#E6FF00',
        'rose-dark': '#D4ED00',
        sage: {
          DEFAULT: '#A8D5BA',
          light: '#C5E6D2',
          dark: '#7BC49A',
        },
        brown: {
          warm: '#4A5568',
          dark: '#1A202C',
          light: '#718096',
        },
      },
      fontFamily: {
        serif: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'yarn-texture': "url('/textures/yarn-bg.svg')",
      },
    },
  },
  plugins: [],
};
