import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import type { Verb } from '@bible/engine'
import { useGame } from '../store/gameStore'
import { selectScene } from '../selectors'
import { VerbFan } from '../components/VerbFan'

// Discovery-first point-and-click. Hotspots are invisible: rest the cursor still over a zone for
// ~0.9s and a soft highlight BLOOMS (and STAYS — until you click empty space). Clicking a zone
// opens a radial verb coin of EVERY action; pick one to act (unsupported ones give a refusal
// line that animates in and fades away on its own). Once you've investigated a zone, selecting it
// again shows its name. The cursor is a soft gold eye.

export function SceneScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectScene(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const lastEvents = useGame((s) => s.lastEvents)

  const [bloom, setBloom] = useState<string | null>(null)
  const [fan, setFan] = useState<{ hotspotId: string; x: number; y: number } | null>(null)
  const [observed, setObserved] = useState<Set<string>>(new Set())
  const [lineKey, setLineKey] = useState<string | null>(null)
  const [lineShown, setLineShown] = useState(false)
  const dwellTimer = useRef<number | undefined>(undefined)

  // Reset discovery + transient text whenever the scene changes.
  const sceneId = view?.sceneId
  useEffect(() => {
    setObserved(new Set())
    setLineShown(false)
    setBloom(null)
  }, [sceneId])

  // A fresh scene line animates in, lingers, then auto-dismisses.
  useEffect(() => {
    const l = lastEvents.flatMap((e) => (e.type === 'sceneLine' ? [e.lineKey] : [])).at(-1)
    if (!l) return
    setLineKey(l)
    setLineShown(true)
    const id = window.setTimeout(() => setLineShown(false), 4000)
    return () => window.clearTimeout(id)
  }, [lastEvents])

  useEffect(() => () => window.clearTimeout(dwellTimer.current), [])

  if (!view) return null

  const dwell = (id: string) => {
    window.clearTimeout(dwellTimer.current)
    dwellTimer.current = window.setTimeout(() => setBloom(id), 900)
  }
  const clearSelection = () => {
    setBloom(null)
    setFan(null)
  }
  const openFan = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.clearTimeout(dwellTimer.current)
    setBloom(id)
    setFan({ hotspotId: id, x: e.clientX, y: e.clientY })
  }
  const pick = (verb: Verb) => {
    if (fan) {
      dispatch({ type: 'world/sceneInteract', sceneId: view.sceneId, hotspotId: fan.hotspotId, verb })
      setObserved((prev) => new Set(prev).add(fan.hotspotId)) // investigated → now identified
    }
    setFan(null) // keep the bloom so the coin can be reopened
  }

  return (
    <div className="screen scene eye-cursor" style={{ backgroundImage: assetBg(view.bgAsset) }} onClick={clearSelection}>
      <div className="scrim soft" />
      <div className="scene-hotspots">
        {view.hotspots.map((h) =>
          h.rect ? (
            <button
              key={h.id}
              className="hotspot"
              style={{ left: `${h.rect.x * 100}%`, top: `${h.rect.y * 100}%`, width: `${h.rect.w * 100}%`, height: `${h.rect.h * 100}%` }}
              onMouseEnter={() => dwell(h.id)}
              onMouseMove={() => dwell(h.id)}
              onClick={(e) => openFan(h.id, e)}
            >
              {bloom === h.id && (
                <motion.span className="bloom" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.55, ease: 'easeOut' }} />
              )}
              {bloom === h.id && observed.has(h.id) && (
                <motion.span className="zone-label" initial={{ opacity: 0, y: 6, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} transition={{ duration: 0.3 }}>
                  {t(h.nameKey)}
                </motion.span>
              )}
            </button>
          ) : null,
        )}
      </div>

      {fan && <VerbFan x={fan.x} y={fan.y} onPick={pick} />}

      <AnimatePresence>
        {lineShown && lineKey && (
          <motion.div
            key={lineKey}
            className="scene-dialog"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.35 }}
          >
            {t(lineKey)}
          </motion.div>
        )}
      </AnimatePresence>

      <button className="btn primary scene-leave" onClick={(e) => { e.stopPropagation(); dispatch({ type: 'world/leaveScene' }) }}>
        {t('ui.scene.leave')}
      </button>
    </div>
  )
}
