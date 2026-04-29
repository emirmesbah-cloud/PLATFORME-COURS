import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),

    // ============================================================
    // PWA — Aurel Academy plateforme étudiant
    // ============================================================
    // - Auto-update : nouvelle version détectée → SW se met à jour seul
    // - Cache strategy :
    //     • assets statiques (JS/CSS/fonts/images) → CacheFirst (instant)
    //     • HTML / app shell → NetworkFirst (toujours frais)
    //     • API Supabase → NetworkOnly (jamais cachée — données live)
    //
    // Installable sur Android (Chrome), iOS (Safari Add to Home Screen),
    // et desktop (Chrome / Edge).
    // ============================================================
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      devOptions: { enabled: false }, // pas de SW en dev local

      // Fichiers statiques copiés dans le SW precache
      includeAssets: [
        'favicon.svg',
        'apple-touch-icon.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-512.png',
      ],

      manifest: {
        name: 'Aurel Academy — Espace étudiant',
        short_name: 'Aurel Academy',
        description: 'Plateforme étudiant Aurel Academy : Deutsch für Pflegekräfte.',
        lang: 'fr',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#F97316',
        background_color: '#FFFFFF',
        categories: ['education', 'productivity'],
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      workbox: {
        // Globaliser tous les assets buildés dans le precache
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico}'],
        // SW prend la main immédiatement après install (pas besoin de reload manuel)
        clientsClaim: true,
        skipWaiting: true,

        // Stratégies de cache runtime
        runtimeCaching: [
          // 1. Google Fonts / fontes externes (si on en utilise un jour)
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // 2. API Supabase REST → JAMAIS de cache (données live)
          {
            urlPattern: /^https:\/\/dvrqtqghgaxhhgkoihcj\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
            options: {
              cacheName: 'supabase-api',
              backgroundSync: {
                name: 'supabase-queue',
                options: { maxRetentionTime: 24 * 60 }, // 24h
              },
            },
          },

          // 3. Images (CDN ou storage Supabase) → cache aggressive
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },

          // 4. App HTML (page principale) → toujours réseau d'abord
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages-cache',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 50 },
            },
          },
        ],

        // Pour SPA : si le SW reçoit une requête de navigation et qu'il
        // n'a pas la page en cache, il sert /index.html (Vite asset).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api\//,
          /^\/functions\//,
        ],
      },
    }),
  ],

  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
