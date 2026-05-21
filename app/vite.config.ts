import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

// Build version pour cache busting cross-browser (lib/version-check.ts)
const BUILD_VERSION = process.env.VITE_BUILD_VERSION
  || process.env.GITHUB_SHA
  || process.env.CF_PAGES_COMMIT_SHA
  || new Date().toISOString();

// SHERLOCK R13 — C1: derive the Supabase host from env at build time so the
// workbox runtimeCaching regex matches the project actually being shipped.
// Falls back to the historical hardcoded host for local dev / sanity.
const FALLBACK_SUPABASE_HOST = 'dvrqtqghgaxhhgkoihcj.supabase.co';
let SUPABASE_HOST = FALLBACK_SUPABASE_HOST;
try {
  const u = process.env.VITE_SUPABASE_URL;
  if (u) SUPABASE_HOST = new URL(u).host;
} catch {
  // Bad URL in env — keep fallback rather than break the build.
}
// Escape dots for the workbox urlPattern regex.
const SUPABASE_HOST_RE = SUPABASE_HOST.replace(/\./g, '\\.');

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  plugins: [
    react(),

    // Plugin maison : émet /version.json à la fin du build
    {
      name: 'emit-version-json',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({
            version: BUILD_VERSION,
            deployedAt: new Date().toISOString(),
          }, null, 2),
        });
      },
    },

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
        // Globaliser les assets buildés dans le precache.
        // SHERLOCK FIX : on EXCLUT html (= index.html). Précédemment, le SW
        // précachait `index.html` immutablement. Combiné avec
        // `clientsClaim:true` + `skipWaiting:true`, un user sur un SW
        // intermédiaire pouvait se retrouver avec un index.html stale qui
        // référençait des chunks JS hashés disparus → blank page jusqu'à
        // un reload manuel. Maintenant l'app shell est servi via le
        // navigateFallback (`NetworkFirst` policy) qui force le réseau
        // d'abord, donc toujours frais.
        globPatterns: ['**/*.{js,css,svg,png,woff2,ico}'],
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

          // 2. API Supabase REST → JAMAIS de cache (données live).
          //
          // SHERLOCK FIX : on RETIRE `backgroundSync`. Avant, Workbox queuait
          // toutes les requêtes échouées (incluant POST/PATCH/DELETE écrits)
          // pendant 24h et les replayait quand le réseau revenait. Si l'user
          // A se déconnectait puis l'user B se loguait sur la même machine
          // dans cette fenêtre, les écritures queueées de A étaient
          // potentiellement rejouées avec l'auth de B → corruption des
          // données. Pour un usage offline propre il faudrait restreindre
          // aux GET seulement et invalider la queue au signOut — non
          // implémenté côté Aurel, donc on désactive carrément.
          {
            // SHERLOCK R13 — C1: pattern built from VITE_SUPABASE_URL (with
            // fallback to the prod project host) so a staging build doesn't
            // miss its own Supabase requests.
            urlPattern: new RegExp(`^https://${SUPABASE_HOST_RE}/.*`, 'i'),
            handler: 'NetworkOnly',
            options: {
              cacheName: 'supabase-api',
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
    // 'hidden' = build *.map files but don't emit `//# sourceMappingURL=...`
    // comments in the JS bundles. Sentry can still upload them at deploy
    // time, but visitors can't download them from prod (was leaking the
    // entire TS source — RLS query shapes, edge-function URLs, admin
    // routes — to anyone hitting `/assets/*.map`).
    sourcemap: 'hidden',
  },
});
