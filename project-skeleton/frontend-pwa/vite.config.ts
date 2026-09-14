import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // injectManifest ולא generateSW: ה-service worker כאן עושה יותר
      // מאשר להגיש קבצים סטטיים — הוא מסמן תשובות שהוגשו מהמטמון
      // (X-From-Cache) כדי שהממשק יוכל לומר למשתמש שהוא רואה נתון ישן.
      // generateSW לא מאפשר להזריק לוגיקה כזו.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: null, // הרישום נעשה ידנית ב-main.tsx
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
      manifest: {
        name: 'CraftMind — עבודות שטח',
        short_name: 'עבודות',
        description: 'המשימות שלי בשטח — צפייה וסגירה מהטלפון.',
        lang: 'he',
        dir: 'rtl',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        // תואם ל-theme-color ב-index.html ולטוקן --color-canvas.
        background_color: '#fafafa',
        theme_color: '#0b0f14',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    // 5174 — frontend-web מחזיק את 5173, שניהם רצים במקביל בפיתוח.
    port: 5174,
    proxy: {
      '/v1': { target: 'http://localhost:3100', changeOrigin: false },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
