import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const pkgJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Internal @bible/* packages ship TypeScript source; alias them so Vite transpiles them as app
// source (rather than serving raw .ts from a node_modules symlink).
// The production build is served under "/game/" (override via VITE_BASE); the dev server stays at "/".
// `preview` mirrors the built base so the PWA (service worker scope, manifest) can be tested locally.
export default defineConfig(({ command, isPreview }) => ({
  base: process.env.VITE_BASE ?? (command === 'build' || isPreview ? '/game/' : '/'),
  define: {
    // Build identity surfaced in Settings (see SettingsScreen). __GIT_SHA__ is injected by CI
    // (VITE_GIT_SHA), otherwise "dev". The actual update prompt is driven by the service worker.
    __APP_VERSION__: JSON.stringify(pkgJson.version),
    __GIT_SHA__: JSON.stringify(process.env.VITE_GIT_SHA ?? 'dev'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null, // we register manually via virtual:pwa-register (see pwa/useServiceWorker)
      // Static files (not part of the JS graph) to add to the precache so install/offline works.
      includeAssets: ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Walk in the Spirit',
        short_name: 'WalkSpirit',
        description: "A pilgrim's roguelike",
        // Relative so they resolve against `base` (/ in dev, /game/ in prod) — never hardcode /game/.
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'landscape',
        theme_color: '#11140f',
        background_color: '#11140f',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only (hashed JS/CSS/HTML + small static assets).
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2,ico}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/assets\//, /\.[^/]+$/],
        runtimeCaching: [
          {
            // Large, stable-named art → CacheFirst (cache on first use; bump cacheName if art is replaced).
            urlPattern: ({ url }) => /\/assets\/.*\.(?:png|jpe?g|webp)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wis-images-v1',
              // Sized to hold every image (57 today) + headroom for future art / multi-world offline
              // downloads. 1-year age so downloaded adventures aren't silently time-evicted.
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Audio → CacheFirst with Range support (<audio> issues Range requests).
            urlPattern: ({ url }) => /\/assets\/.*\.mp3$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wis-audio-v1',
              // Must exceed the ~33 mp3s or a full offline download LRU-evicts itself. 1-year age so
              // downloaded adventures persist. rangeRequests stays on (<audio> issues Range requests).
              expiration: { maxEntries: 48, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
        ],
      },
      devOptions: { enabled: false, type: 'module', navigateFallback: 'index.html' },
    }),
  ],
  resolve: {
    alias: {
      '@bible/engine': pkg('../../packages/engine/src/index.ts'),
      '@bible/content': pkg('../../packages/content/src/index.ts'),
      '@bible/i18n': pkg('../../packages/i18n/src/index.ts'),
      '@bible/persistence': pkg('../../packages/persistence/src/index.ts'),
      '@bible/assets': pkg('../../packages/assets/src/index.ts'),
    },
  },
  server: { port: 5173 },
}))
