import { describe, expect, it } from 'vitest'
import { AUDIO_CACHE_MAX_ENTRIES, IMAGE_CACHE_MAX_ENTRIES } from './cacheCaps'

// Every deployed image/audio can end up in the corresponding Workbox runtime cache (CacheFirst on
// first fetch / offline warm). If the asset count ever exceeds the cache cap, Workbox silently
// LRU-evicts — quietly breaking downloaded-for-offline adventures. Fail CI first instead.
// import.meta.glob lists matching files at build time (Vite/vitest), so no node:fs — this runs under
// the app's DOM-only tsconfig.
const images = Object.keys(import.meta.glob('../../public/assets/*.{webp,png,jpg,jpeg}')).length
const audio = Object.keys(import.meta.glob('../../public/assets/*.mp3')).length

describe('runtime cache caps cover the whole asset set', () => {
  it('image cache holds every deployed image', () => {
    expect(images).toBeGreaterThan(0)
    expect(images).toBeLessThanOrEqual(IMAGE_CACHE_MAX_ENTRIES)
  })
  it('audio cache holds every deployed audio file', () => {
    expect(audio).toBeGreaterThan(0)
    expect(audio).toBeLessThanOrEqual(AUDIO_CACHE_MAX_ENTRIES)
  })
})
