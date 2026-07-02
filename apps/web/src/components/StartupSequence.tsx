import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { resolveAsset } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { sfxManager } from '../audio/sfxManager'
import { musicManager } from '../audio/musicManager'
import { LOGO_CARDS, LOGO_STING_KEYS, type LogoCard } from './startupLogos'

// The AAA-style studio-logo intro. A full-viewport black overlay (mounted at the App root, above the
// scaled stage) that runs a short phase machine and, when done, fades out to reveal the title screen:
//
//   gate ("tap to begin")  →  logos (crossfade cards + stings)  →  loading (fake bar)  →  out → done
//
// The opening gate exists because browsers keep audio suspended until a user gesture; that first tap
// unlocks the AudioContext (so the stings reliably play) and starts the cinematic. The same tap/key
// later SKIPS straight to the end. A calm ambient bed (a private <audio>) plays under the cards while
// the title music is held (see MusicController + the `booting` store flag), then fades out on finish.

type Phase = 'gate' | 'logos' | 'loading' | 'out'

const clamp01 = (v: number): number => (!Number.isFinite(v) ? 0 : v < 0 ? 0 : v > 1 ? 1 : v)

// Timings (ms). Reduced motion cuts the fades and trims the holds.
const TIMING = {
  normal: { fade: 600, hold: 1200, gap: 170, loading: 1500, out: 650, ambientFade: 700 },
  reduced: { fade: 0, hold: 850, gap: 60, loading: 850, out: 0, ambientFade: 250 },
}

export function StartupSequence({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation()
  const reducedMotion = useGame((s) => s.state.profile.settings.reducedMotion)
  const timing = reducedMotion ? TIMING.reduced : TIMING.normal

  const [phase, setPhase] = useState<Phase>('gate')
  const [index, setIndex] = useState(0)
  const [cardVisible, setCardVisible] = useState(false)
  const [imgError, setImgError] = useState(false)

  // Mutable bits the timers + global listeners read, kept in refs so their closures never go stale.
  const phaseRef = useRef<Phase>('gate')
  phaseRef.current = phase
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete
  const timingRef = useRef(timing)
  timingRef.current = timing

  const begun = useRef(false)
  const finished = useRef(false)
  const timers = useRef<number[]>([])
  const ambientEl = useRef<HTMLAudioElement | null>(null)
  const ambientFade = useRef<number | null>(null)

  const after = (ms: number, fn: () => void): void => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const clearTimers = (): void => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  // Preload the sting buffers up front so the first whoosh isn't delayed by a fetch/decode.
  useEffect(() => {
    sfxManager.preload(LOGO_STING_KEYS)
  }, [])

  // Teardown: stop every timer and the ambient bed if we unmount mid-intro.
  useEffect(() => {
    return () => {
      clearTimers()
      if (ambientFade.current != null) window.clearInterval(ambientFade.current)
      ambientEl.current?.pause()
      ambientEl.current = null
    }
  }, [])

  const startAmbient = (): void => {
    const { settings } = useGame.getState().state.profile
    // The bed is "music" — only when audio mode is fully on, scaled by the music volume.
    if (settings.audioMode !== 'on') return
    const url = resolveAsset('music/startup')
    if (!url) return
    const el = new Audio(url)
    el.loop = false // play the ambient intro ONCE — never restart it mid-sequence
    el.volume = clamp01(settings.musicVolume)
    ambientEl.current = el
    void el.play().catch(() => {
      /* blocked despite the gesture — fine, the intro just runs without the bed */
    })
  }

  const stopAmbient = (): void => {
    const el = ambientEl.current
    ambientEl.current = null
    if (!el) return
    const start = el.volume
    const steps = 14
    let i = 0
    ambientFade.current = window.setInterval(() => {
      i += 1
      el.volume = Math.max(0, start * (1 - i / steps))
      if (i >= steps) {
        if (ambientFade.current != null) window.clearInterval(ambientFade.current)
        ambientFade.current = null
        el.pause()
      }
    }, timingRef.current.ambientFade / steps)
  }

  const fireStings = (card: LogoCard): void => {
    for (const s of card.stings) {
      if (s.delayMs) after(s.delayMs, () => sfxManager.play(s.key, { gain: s.gain }))
      else sfxManager.play(s.key, { gain: s.gain })
    }
  }

  const playCard = (i: number): void => {
    if (i >= LOGO_CARDS.length) {
      startLoading()
      return
    }
    const tm = timingRef.current
    const c = LOGO_CARDS[i]!
    setIndex(i)
    setImgError(false)
    setCardVisible(false) // hold on black until the reveal…
    fireStings(c) // …stings fire on enter (t=0) — e.g. the light-switch click
    const reveal = reducedMotion ? 0 : c.revealDelayMs ?? 0
    after(reveal, () => setCardVisible(true)) // …then the card "turns on"
    after(reveal + tm.fade + tm.hold, () => {
      setCardVisible(false) // …linger, then fade out
      after(tm.fade + tm.gap, () => playCard(i + 1)) // …a beat of black, then the next
    })
  }

  const startLoading = (): void => {
    setPhase('loading')
    // Seam for real prefetch later (asset preloads / update check): await them here, then finish().
    after(timingRef.current.loading, finish)
  }

  const finish = (): void => {
    if (finished.current) return
    finished.current = true
    clearTimers()
    stopAmbient()
    setPhase('out') // fade the whole overlay out to reveal the title underneath
    after(timingRef.current.out, () => onCompleteRef.current())
  }

  const begin = (): void => {
    if (begun.current) return
    begun.current = true
    // Inside the user gesture: unlock audio + start the ambient bed, then run the cards.
    sfxManager.unlock()
    musicManager.unlock()
    startAmbient()
    setPhase('logos')
    playCard(0)
  }

  // One input handler: tap/key starts the intro from the gate, or skips it once running.
  const advance = (): void => {
    const p = phaseRef.current
    if (p === 'gate') begin()
    else if (p === 'logos' || p === 'loading') finish()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Tab') return // don't hijack focus traversal
      advance()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // advance reads phase via ref, so this listener is bound once and never needs re-binding.
  }, [])

  const card = LOGO_CARDS[index]!
  const url = !imgError ? resolveAsset(card.assetRef) : undefined
  const showCaption = !url || card.captionWithImage !== false
  const fadeS = timing.fade / 1000

  return (
    <motion.div
      className="startup"
      role="dialog"
      aria-label="Studio intro"
      onPointerDown={advance}
      initial={{ opacity: 1 }}
      animate={{ opacity: phase === 'out' ? 0 : 1 }}
      transition={{ duration: timing.out / 1000, ease: 'easeInOut' }}
    >
      {phase === 'gate' && (
        <div className="startup-gate">
          <span className="startup-gate-text">{t('ui.startup.tapToBegin')}</span>
        </div>
      )}

      {(phase === 'logos' || phase === 'out') && (
        <motion.div
          key={index}
          className={`startup-card v-${card.variant}`}
          initial={{ opacity: 0, scale: 1.012 }}
          animate={{ opacity: cardVisible ? 1 : 0, scale: cardVisible ? 1 : 1.012 }}
          transition={{ duration: fadeS, ease: 'easeInOut' }}
        >
          {card.variant === 'divine' && !url && <div className="startup-glow" aria-hidden />}
          {/* studio card: a warm light "turns on" at the center and shines outward to reveal the logo —
              a point of light that flares + expands, then settles into the resting glow. */}
          {card.variant === 'studio' && (
            <motion.div
              className="startup-light"
              aria-hidden
              initial={{ opacity: 0, scale: 0.04 }}
              animate={{
                // brightness pops to full almost instantly (a point of light "turns on"), then settles…
                opacity: cardVisible ? (reducedMotion ? 0.55 : [0, 1, 0.55]) : 0,
                // …while the point expands outward — the scale is the visible motion, not a fade.
                // Stay collapsed to a point while hidden so the expansion triggers on reveal (not at mount).
                scale: cardVisible ? 1 : 0.04,
              }}
              transition={{
                opacity: { duration: reducedMotion ? 0 : 1.05, ease: 'easeOut', times: [0, 0.14, 1] },
                scale: { duration: reducedMotion ? 0 : 1.05, ease: 'easeOut' },
              }}
            />
          )}
          {url ? (
            <img
              className={`startup-img t-${card.imageTreatment ?? 'framed'}`}
              src={url}
              alt=""
              onError={() => setImgError(true)}
            />
          ) : (
            <div className="startup-glyph" aria-hidden>
              {card.glyph}
            </div>
          )}
          {showCaption && (
            <div className="startup-text">
              {card.taglineKey && <div className="startup-tagline">{t(card.taglineKey)}</div>}
              <div className="startup-caption">{t(card.captionKey)}</div>
              {card.subcaption && <div className="startup-sub">{card.subcaption}</div>}
            </div>
          )}
        </motion.div>
      )}

      {phase === 'loading' && (
        <div className="startup-loading">
          <div className="startup-bar">
            <motion.div
              className="startup-bar-fill"
              initial={{ width: '0%' }}
              animate={{ width: '100%' }}
              transition={{ duration: timing.loading / 1000, ease: 'easeInOut' }}
            />
          </div>
          <span className="startup-loading-text">{t('ui.startup.loading')}</span>
        </div>
      )}
    </motion.div>
  )
}
