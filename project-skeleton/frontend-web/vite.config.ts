import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    proxy: {
      // ה-API רץ על 3000. proxy נמנע מ-CORS בפיתוח ושומר על
      // ה-Host, שממנו ה-middleware מזהה טננט.
      '/v1': { target: 'http://localhost:3100', changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: true },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test-setup.ts'] },
});
