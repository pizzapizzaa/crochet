/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FDFBF7',
          100: '#FAF7F2',
          200: '#F3EDE2',
          300: '#EBE0CE',
        },
        rose: {
          dust: '#C4967A',
          light: '#D4AA94',
          dark: '#A87A62',
        },
        sage: {
          DEFAULT: '#8B9E87',
          light: '#A8BAA4',
          dark: '#6E8169',
        },
        brown: {
          warm: '#5C3D2E',
          dark: '#2A1F1A',
          light: '#6B4F42',
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
