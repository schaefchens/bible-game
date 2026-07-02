// Offline pre-download for the PWA. The service worker (generateSW) already runs CacheFirst routes
// for /assets/*.{webp,png,jpg} and /assets/*.mp3, so a plain fetch(url) from here is intercepted and
// stored — warming those caches ahead of play. We (a) warm the intro+menu "shell" so the installed
// app opens offline, and (b) warm one adventure's full asset set on demand. caches.match tells us
// what's actually cached (the browser may evict), so it's the source of truth for "offline ready".
//
// Dev caveat: the SW is disabled in `npm run dev` (vite.config devOptions.enabled:false); this all
// only takes effect in a production build (`npm run build && npm run preview`). swActive() reflects that.

import { enumerateWorldAssetRefs, type ContentBundle } from '@bible/engine'
import { resolveAsset } from '@bible/assets'
import { asset } from '../asset'
import { ALL_COMBAT_SFX } from '../audio/combatSfx'

export interface WarmProgress {
  loaded: number
  total: number
  failed: number
}
export interface WarmOptions {
  onProgress?: (p: WarmProgress) => void
  concurrency?: number
  signal?: AbortSignal
}

/** True only when the generated service worker is actually controlling this page (prod build/preview,
 *  not `npm run dev`). Used to decide whether warming/caching can do anything. */
export function swActive(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker.controller
}

const dedup = (xs: string[]): string[] => [...new Set(xs)]
const refsToUrls = (refs: string[]): string[] =>
  refs.map((r) => resolveAsset(r)).filter((u): u is string => Boolean(u))

/** Intro + start-menu + world-select assets that must be warm for the installed app to open offline.
 *  A FUNCTION (not a const) so it reads the asset base after setAssetBase() has run in main.tsx. */
export function getShellUrls(): string[] {
  // World-select card thumbnails + a couple of menu backdrops are referenced by RAW filename.
  const rawFiles = [
    'bg-menu-startscreen.webp',
    'bg-menu-fireplace.webp',
    'bg-map-parchment.webp',
    'bg-rest-old-cistern.webp',
    'bg-combat-rocky-pass.webp',
    'bg-road-dusty-road.webp',
  ].map(asset)
  // Studio-logo art + intro/menu audio + intro stings are registered AssetRefs. logo/claude is an SVG
  // (already in the precache glob) so it's omitted here.
  const refs = [
    'logo/lamm',
    'logo/god',
    'logo/misselle',
    'music/startup',
    'music/startscreen',
    'sfx/logo-whoosh',
    'sfx/logo-whoosh-soft',
    'sfx/logo-sheep',
    'sfx/logo-ding',
    'sfx/light-switch',
  ]
  return dedup([...rawFiles, ...refsToUrls(refs)])
}

/** Every asset URL one adventure needs offline: enumerated content refs ∪ shared combat SFX. */
export function worldUrls(bundle: ContentBundle, worldId: string): string[] {
  const refs = [...enumerateWorldAssetRefs(bundle, worldId), ...ALL_COMBAT_SFX]
  return dedup(refsToUrls(refs))
}

/** How many of `urls` are already in Cache Storage (searches all caches from the window context). */
export async function cachedCount(urls: string[]): Promise<number> {
  if (typeof caches === 'undefined') return 0
  const hits = await Promise.all(urls.map((u) => caches.match(u).then((r) => (r ? 1 : 0)).catch(() => 0)))
  return hits.reduce((a, b) => a + b, 0)
}

export async function isFullyCached(urls: string[]): Promise<boolean> {
  return urls.length > 0 && (await cachedCount(urls)) === urls.length
}

/** Fetch every URL (bounded concurrency) so the SW's CacheFirst routes populate their caches. Plain
 *  (non-Range) fetches so workbox stores the FULL mp3 body. Never throws. Progress increments once per
 *  settled URL (monotonic → total).
 *
 *  `failed` counts only REAL problems (network error / 5xx) — a 404 is treated as "genuinely absent"
 *  and does NOT count as a failure: some registered refs legitimately have no file (e.g. the companion
 *  sprite → emoji fallback), and such assets can't and needn't be cached to play offline. So a download
 *  with only 404s still completes. */
export async function warmCache(urls: string[], opts: WarmOptions = {}): Promise<WarmProgress> {
  const { onProgress, concurrency = 6, signal } = opts
  const total = urls.length
  let loaded = 0
  let failed = 0
  let next = 0
  const report = (): void => onProgress?.({ loaded, total, failed })
  report()
  const worker = async (): Promise<void> => {
    while (next < total) {
      if (signal?.aborted) return
      const url = urls[next++]!
      try {
        const res = await fetch(url, { signal })
        if (!res.ok && res.status !== 404) failed++ // 404 = absent-by-design; tolerated
      } catch {
        if (!signal?.aborted) failed++ // network error (offline mid-download); abort is not a failure
      }
      loaded++
      report()
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) || 0 }, worker))
  return { loaded, total, failed }
}
