import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import type { Verb } from '@bible/engine'
import { useGame } from '../store/gameStore'
import { selectScene } from '../selectors'
import { VerbFan } from '../components/VerbFan'

// Discovery-first point-and-click. Hotspots are invisible: rest the cursor still over a zone for
// ~0.9s and a soft highlight BLOOMS (and STAYS — until you click empty space). Clicking a zone
// opens a radial verb coin of EVERY action around the cursor; pick one to act (unsupported ones
// just give a refusal line). The cursor is a soft gold eye.

export function SceneScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectScene(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const lastEvents = useGame((s) => s.lastEvents)
  const [bloom, setBloom] = useState<string | null>(null)
  const [fan, setFan] = useState<{ hotspotId: string; x: number; y: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const line = lastEvents.flatMap((e) => (e.type === 'sceneLine' ? [e.lineKey] : [])).at(-1)
  if (!view) return null

  // (re)start the dwell timer on movement; once still for a beat the zone blooms and STAYS bloomed
  const dwell = (id: string) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setBloom(id), 900)
  }

  const clearSelection = () => {
    setBloom(null)
    setFan(null)
  }

  const openFan = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.clearTimeout(timer.current)
    setBloom(id)
    setFan({ hotspotId: id, x: e.clientX, y: e.clientY })
  }

  const pick = (verb: Verb) => {
    if (fan) dispatch({ type: 'world/sceneInteract', sceneId: view.sceneId, hotspotId: fan.hotspotId, verb })
    setFan(null) // keep the bloom so the player can reopen the coin
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
                <motion.span
                  className="bloom"
                  initial={{ scale: 0.4, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
              )}
            </button>
          ) : null,
        )}
      </div>

      {fan && <VerbFan x={fan.x} y={fan.y} onPick={pick} />}

      <div className="scene-dialog">{line ? t(line) : ''}</div>

      <button className="btn primary scene-leave" onClick={(e) => { e.stopPropagation(); dispatch({ type: 'world/leaveScene' }) }}>
        {t('ui.scene.leave')}
      </button>
    </div>
  )
}
