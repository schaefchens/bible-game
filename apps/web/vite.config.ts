import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'
import { AUDIO_CACHE_MAX_ENTRIES, IMAGE_CACHE_MAX_ENTRIES } from './src/pwa/cacheCaps'

const pkg = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const pkgJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

// Short commit SHA baked into the build so Settings shows the real revision. CI may pass VITE_GIT_SHA;
// otherwise derive it from git here (a "-dirty" suffix flags an uncommitted build), falling back to
// 'dev' only when no git repo is available (e.g. building from a source tarball).
const gitSha =
  process.env.VITE_GIT_SHA ??
  (() => {
    try {
      const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
      const dirty = execSync('git status --porcelain', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
      return dirty ? `${sha}-dirty` : sha
    } catch {
      return 'dev'
    }
  })()

// Internal @bible/* packages ship TypeScript source; alias them so Vite transpiles them as app
// source (rather than serving raw .ts from a node_modules symlink).
//
// The web build owns the domain root (walkinthespirit.games.schaefchens.de), so `base` is "/"
// everywhere. It used to be "/game/" under the old hosting; nothing hardcodes either — every
// asset URL goes through `base` (see src/asset.ts and setAssetBase in main.tsx).
//
// VITE_BASE overrides it. Capacitor is the reason it still exists: an Android/iOS build loads
// index.html off the local filesystem, where an absolute "/" resolves to the device root and
// every asset 404s. `npm run build:app` sets VITE_BASE=./ so URLs stay relative to the document.
const BASE = process.env.VITE_BASE ?? '/'

// Capacitor also has no use for a service worker — the native shell already serves the bundle
// locally, and a second cache layer inside the webview only invents staleness bugs. `disable`
// keeps the `virtual:pwa-register` module resolvable (as a no-op), so nothing has to be
// conditionally imported in app code.
const PWA_DISABLED = process.env.VITE_DISABLE_PWA === '1'

export default defineConfig(() => ({
  base: BASE,
  define: {
    // Build identity surfaced in Settings (see SettingsScreen). __GIT_SHA__ is injected by CI
    // (VITE_GIT_SHA), otherwise "dev". The actual update prompt is driven by the service worker.
    __APP_VERSION__: JSON.stringify(pkgJson.version),
    __GIT_SHA__: JSON.stringify(gitSha),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      disable: PWA_DISABLED,
      registerType: 'prompt',
      injectRegister: null, // we register manually via virtual:pwa-register (see pwa/useServiceWorker)
      // Static files (not part of the JS graph) to add to the precache so install/offline works.
      includeAssets: ['favicon.ico', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Walk in the Spirit',
        short_name: 'WalkSpirit',
        description: "A pilgrim's roguelike",
        // Relative so they resolve against `base` — never hardcode an absolute path here.
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
              // maxEntries set high so it never binds (quota is the real limit); a tight cap would
              // silently evict a downloaded adventure. cacheCaps.test.ts guards count ≤ cap. 1-yr age.
              expiration: { maxEntries: IMAGE_CACHE_MAX_ENTRIES, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Audio → CacheFirst with Range support (<audio> issues Range requests).
            urlPattern: ({ url }) => /\/assets\/.*\.mp3$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'wis-audio-v1',
              // High cap so a full offline download can't LRU-evict itself; guarded by cacheCaps.test.ts.
              // 1-yr age; rangeRequests stays on (<audio> issues Range requests during playback).
              expiration: { maxEntries: AUDIO_CACHE_MAX_ENTRIES, maxAgeSeconds: 60 * 60 * 24 * 365 },
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
  // Dev: proxy the co-op WebSocket to the local Node server so a plain same-origin ws://…/ws works
  // without setting VITE_WS_URL. The server ignores the path, so /ws → :8787 is fine.
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
}))
