import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { resolveAsset } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { musicManager } from '../audio/musicManager'

// The prayer cinematic: praying at a fire/inn slowly fades in a golden overlay (opaque in the centre
// so the underlying screen can't distract, translucent at the edges for a heavenly halo) while the
// background music fades out and the prayer song swells in (looping). After the gold has settled, the
// psalms begin: each fades slowly in, lingers, fades out — then a beat of pure gold — before the next.
// Prayer holds INDEFINITELY until the player clicks anywhere or taps "Amen".

const PSALMS = ['pray.psalm.1', 'pray.psalm.2', 'pray.psalm.3', 'pray.psalm.4']
const GOLD_BEFORE_TEXT_MS = 5500 // let the gold fade in and settle before any words appear
const FADE_MS = 3500 // each psalm fades slowly in (and out)
const HOLD_MS = 9000 // …then lingers a good while
const GAP_MS = 2500 // …then a beat of pure gold before the next psalm

export function PrayOverlay() {
  const { t } = useTranslation()
  const praying = useGame((s) => s.praying)
  const setPraying = useGame((s) => s.setPraying)
  const [idx, setIdx] = useState(0)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!praying) {
      setShown(false)
      setIdx(0)
      return
    }
    musicManager.setPraying(true, resolveAsset('music/prayer') ?? undefined)
    let alive = true
    let timer: number
    let i = 0
    const showNext = () => {
      setIdx(i)
      setShown(true) // fade in
      timer = window.setTimeout(() => {
        setShown(false) // …linger, then fade out
        timer = window.setTimeout(() => {
          i = (i + 1) % PSALMS.length
          if (alive) showNext() // …a beat of gold, then the next psalm
        }, FADE_MS + GAP_MS)
      }, FADE_MS + HOLD_MS)
    }
    timer = window.setTimeout(() => { if (alive) showNext() }, GOLD_BEFORE_TEXT_MS)
    return () => {
      alive = false
      window.clearTimeout(timer)
      musicManager.setPraying(false) // amen: prayer song fades out, background music returns
    }
  }, [praying])

  return (
    <div className={`pray-overlay${praying ? ' active' : ''}`} aria-hidden={!praying} onClick={() => praying && setPraying(false)}>
      <div className="pray-stage">
        <AnimatePresence mode="wait">
          {shown && (
            <motion.p
              key={idx}
              className="pray-line"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: FADE_MS / 1000, ease: 'easeInOut' }}
            >
              {t(PSALMS[idx]!)}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      {praying && (
        <button className="btn pray-amen" onClick={(e) => { e.stopPropagation(); setPraying(false) }}>
          {t('ui.pray.amen')}
        </button>
      )}
    </div>
  )
}
