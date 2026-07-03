import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'
import { cachedCount, swActive, warmCache, worldUrls } from '../pwa/offlineCache'

// The selectable adventures. Tutorial first (always open); later worlds stay locked until the world
// named in `unlockedBy` has been completed (its boss beaten). Title/subtitle are i18n keys.
interface WorldCard {
  id: string
  titleKey: string
  subtitleKey: string
  bg: string
  tagKey?: string
  unlockedBy?: string
}
// Progression: tutorial (world-02) → both Valley of Elah (world-03) and The Road to Jericho (world-01)
// unlock together once the tutorial is completed.
const WORLDS: WorldCard[] = [
  { id: 'world-02', titleKey: 'ui.worldSelect.world02.title', subtitleKey: 'ui.worldSelect.world02.subtitle', bg: 'bg-rest-old-cistern.webp', tagKey: 'ui.worldSelect.tutorialTag' },
  { id: 'world-03', titleKey: 'ui.worldSelect.world03.title', subtitleKey: 'ui.worldSelect.world03.subtitle', bg: 'bg-combat-rocky-pass.webp', unlockedBy: 'world-02' },
  { id: 'world-01', titleKey: 'ui.worldSelect.world01.title', subtitleKey: 'ui.worldSelect.world01.subtitle', bg: 'bg-road-dusty-road.webp', unlockedBy: 'world-02' },
]

// Per-card offline-download state. 'unavailable' = no service worker controlling (dev / not a PWA
// install) so caching can't happen; 'stale' = the persisted flag says downloaded but the cache is
// incomplete (browser eviction) → offer a re-download.
type DlStatus = 'idle' | 'checking' | 'downloading' | 'done' | 'stale' | 'error' | 'unavailable'

export function WorldSelect() {
  const { t } = useTranslation()
  const dispatch = useGame((s) => s.dispatch)
  const completedWorlds = useGame((s) => s.state.profile.completedWorlds)

  return (
    <div className="screen centered">
      <div className="vignette" />
      <div className="panel world-panel">
        <h2>{t('ui.worldSelect.title')}</h2>
        <div className="world-cards">
          {WORLDS.map((w) => (
            <WorldCardView key={w.id} w={w} locked={!!w.unlockedBy && !completedWorlds.includes(w.unlockedBy)} />
          ))}
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
            {t('ui.common.back')}
          </button>
        </div>
      </div>
    </div>
  )
}

function WorldCardView({ w, locked }: { w: WorldCard; locked: boolean }) {
  const { t } = useTranslation()
  const content = useGame((s) => s.content)
  const lastSelectedId = useGame((s) => s.state.profile.lastSelectedId)
  const downloaded = useGame((s) => s.state.profile.downloadedWorlds.includes(w.id))
  const startRun = useGame((s) => s.startRun)
  const setWorldDownloaded = useGame((s) => s.setWorldDownloaded)

  const urls = useMemo(() => worldUrls(content, w.id), [content, w.id])
  const [status, setStatus] = useState<DlStatus>('checking')
  const [pct, setPct] = useState(0)
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  const abortRef = useRef<AbortController | null>(null)

  // Reconcile the persisted flag against what's ACTUALLY in the cache (the browser may have evicted).
  useEffect(() => {
    let cancelled = false
    if (!swActive()) {
      setStatus('unavailable')
      return
    }
    setStatus('checking')
    // Reconcile the flag with the cache, tolerant of absent-by-design assets (a 404 ref like the
    // companion sprite can never be cached, so we don't demand cachedCount === total). Full cache →
    // done; flagged but the cache looks wiped (nothing there) → stale; flagged with most present →
    // trust it (partial eviction degrades gracefully in-run).
    void cachedCount(urls).then((n) => {
      if (cancelled) return
      if (urls.length > 0 && n === urls.length) setStatus('done')
      else if (downloaded) setStatus(n === 0 ? 'stale' : 'done')
      else setStatus('idle')
    })
    return () => {
      cancelled = true
    }
    // Reconcile once per world (urls is stable per card). Deliberately NOT keyed on `downloaded`: a
    // successful download flips that flag, and re-running here would flash 'checking' + re-scan the
    // cache right after we set 'done'. `downloaded` is read fresh at mount, which is all we need.
  }, [urls])

  // Track connectivity so the Download button enables/disables live.
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  /** Fetch the whole world into the cache. Persists the flag only if EVERYTHING landed. */
  const download = async (): Promise<void> => {
    void navigator.storage?.persist?.() // best-effort: ask the browser not to evict our caches
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setStatus('downloading')
    setPct(0)
    const res = await warmCache(urls, {
      signal: ac.signal,
      onProgress: ({ loaded, total }) => {
        if (!ac.signal.aborted) setPct(total ? Math.round((loaded / total) * 100) : 100)
      },
    })
    if (ac.signal.aborted) return
    // Done when nothing REAL failed (404s are tolerated absent assets). Only then persist the flag.
    const ok = res.failed === 0
    setStatus(ok ? 'done' : 'error')
    if (ok) setWorldDownloaded(w.id, true)
  }

  /** "Both": Begin auto-downloads anything not yet cached (when online) before entering; offline or
   *  already-cached → enter immediately. Uncached offline play degrades gracefully. */
  const begin = async (): Promise<void> => {
    if (locked || !lastSelectedId) return
    if (online && swActive() && status !== 'done') {
      await download()
      if (abortRef.current?.signal.aborted) return // navigated away mid-download → don't force-enter the run
    }
    startRun(lastSelectedId, w.id)
  }

  const busy = status === 'downloading'
  const showDownload = !locked && status !== 'unavailable'

  return (
    <div className={'world-card' + (locked ? ' locked' : '')} style={{ backgroundImage: bgUrl(w.bg) }}>
      <div className="world-card-body">
        {w.tagKey && <span className="world-tag">{t(w.tagKey)}</span>}
        <h3>{t(w.titleKey)}</h3>
        <p className="muted">{locked ? t('ui.worldSelect.locked') : t(w.subtitleKey)}</p>

        <button className="btn primary" disabled={locked || !lastSelectedId || busy} onClick={() => void begin()}>
          {locked ? `🔒 ${t('ui.worldSelect.begin')}` : t('ui.worldSelect.begin')}
        </button>

        {showDownload && (
          <div className="world-download">
            {status === 'done' && <span className="world-offline-badge">✓ {t('ui.worldSelect.downloaded')}</span>}
            {busy && (
              <div className="world-dl-progress">
                <div className="startup-bar">
                  <div className="startup-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="muted">{t('ui.worldSelect.downloading')} {pct}%</span>
              </div>
            )}
            {(status === 'idle' || status === 'stale' || status === 'error') && (
              <button className="btn small" disabled={!online} onClick={() => void download()}>
                {status === 'error'
                  ? t('ui.worldSelect.retry')
                  : status === 'stale'
                    ? `↻ ${t('ui.worldSelect.redownload')}`
                    : `⬇ ${t('ui.worldSelect.download')}`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
