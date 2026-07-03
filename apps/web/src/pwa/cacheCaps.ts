// Entry ceilings for the Workbox CacheFirst runtime caches (see vite.config.ts). Set high on purpose:
// the browser storage quota + `maxAgeSeconds` are the real limits, and a TIGHT `maxEntries` would
// silently LRU-evict a downloaded adventure's assets (badge still says "✓", art 404s offline). A test
// (cacheCaps.test.ts) asserts the whole deployed asset set stays under these, so lowering a cap below
// the asset count — or a runaway content growth — fails CI instead of silently evicting. One source of
// truth for config + test.
export const IMAGE_CACHE_MAX_ENTRIES = 1000
export const AUDIO_CACHE_MAX_ENTRIES = 1000
