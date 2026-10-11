import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';

export default defineConfig({
  integrations: [tailwind(), react()],
  output: 'static',
  adapter: vercel(),
  security: {
    checkOrigin: false,
  },
  vite: {
    optimizeDeps: {
      include: ['react', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-moveable', 'lucide-react'],
    },
  },
});
