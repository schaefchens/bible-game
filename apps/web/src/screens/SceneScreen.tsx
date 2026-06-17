import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import type { Verb } from '@bible/engine'
import { useGame } from '../store/gameStore'
import { selectScene } from '../selectors'
import { VerbFan } from '../components/VerbFan'

// Discovery-first point-and-click. Hotspots are invisible: rest the cursor (hover) OR press-and-hold
// (mouse/touch) still over a zone for ~0.9s and a soft highlight BLOOMS and its radial verb coin
// opens (pick an action; unsupported ones give a refusal line that fades on its own). A quick
// tap/click does NOTHING — so you can't spoil the scene by tapping wildly; finding a zone takes the
// same deliberate dwell whether you hover or hold. Known zones open at once. Cursor is a soft gold eye.

export function SceneScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectScene(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const lastEvents = useGame((s) => s.lastEvents)
  const toggleInventory = useGame((s) => s.toggleInventory)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const aimItemAt = useGame((s) => s.aimItemAt)

  const [bloom, setBloom] = useState<string | null>(null)
  const [fan, setFan] = useState<{ hotspotId: string; x: number; y: number } | null>(null)
  const [observed, setObserved] = useState<Set<string>>(new Set())
  const [lineKey, setLineKey] = useState<string | null>(null)
  const [lineShown, setLineShown] = useState(false)
  const dwellTimer = useRef<number | undefined>(undefined)
  const holdTimer = useRef<number | undefined>(undefined)

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

  useEffect(() => () => { window.clearTimeout(dwellTimer.current); window.clearTimeout(holdTimer.current) }, [])

  if (!view) return null

  // Carrying a bag item behaves EXACTLY like the no-item discovery cursor (dwell → bloom → click) —
  // no target highlighting, no spoilers; the only differences are the cursor is the item ghost and a
  // click on a revealed zone opens the ITEM action wheel instead of the verb fan (see openFan).
  const carrying = itemInteraction != null

  const dwell = (id: string) => {
    window.clearTimeout(dwellTimer.current)
    // already identified → bloom at once (we know this zone); unknown zones still need the dwell
    if (observed.has(id)) {
      setBloom(id)
      return
    }
    dwellTimer.current = window.setTimeout(() => setBloom(id), 900)
  }
  const clearSelection = () => {
    setBloom(null)
    setFan(null)
    // dropping a held item / closing the bag on an empty click is owned by InventoryLayer's handler
  }
  const openFan = (id: string, x: number, y: number) => {
    window.clearTimeout(dwellTimer.current)
    setBloom(id)
    // carrying an item → open the ITEM action wheel on this (revealed) zone instead of the verb fan
    if (itemInteraction?.phase === 'holding') {
      aimItemAt({ kind: 'hotspot', id }, { x, y })
      return
    }
    // toggle: selecting the same zone again (without choosing an action) closes the coin
    setFan((cur) => (cur && cur.hotspotId === id ? null : { hotspotId: id, x, y }))
  }
  // Press-and-hold to DISCOVER: holding on an undiscovered zone for the dwell time blooms it and
  // opens its coin — the touch/mouse analog of resting the cursor (hover). A quick tap does nothing,
  // so the scene can't be spoiled by tapping wildly. (Already-observed zones skip this — see onTap.)
  const startHold = (id: string, e: React.PointerEvent) => {
    if (observed.has(id)) return
    e.stopPropagation()
    const { clientX, clientY } = e
    window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => openFan(id, clientX, clientY), 900)
  }
  const endHold = () => { window.clearTimeout(holdTimer.current); window.clearTimeout(dwellTimer.current) }
  // A tap/click acts on a zone once it's REVEALED — i.e. currently bloomed (from a hover/hold dwell)
  // or already investigated. A zone can only bloom via the deliberate dwell, never a quick tap, so an
  // unrevealed zone still ignores taps — that's what stops wild tapping from spoiling the scene.
  const onTap = (id: string, e: React.MouseEvent) => {
    // Only a REVEALED zone "handles" the click (stop it bubbling to the backdrop). An unrevealed,
    // still-invisible zone lets the click pass through — so it reads as clicking empty space (which
    // drops a held item, and otherwise does nothing) instead of silently swallowing the click.
    if (bloom === id || observed.has(id)) {
      e.stopPropagation()
      openFan(id, e.clientX, e.clientY)
    }
  }
  const pick = (verb: Verb) => {
    if (fan) {
      dispatch({ type: 'world/sceneInteract', sceneId: view.sceneId, hotspotId: fan.hotspotId, verb })
      setObserved((prev) => new Set(prev).add(fan.hotspotId)) // investigated → now identified
    }
    setFan(null) // keep the bloom so the coin can be reopened
  }

  return (
    <div
      className={`screen scene ${carrying ? '' : 'eye-cursor'}`}
      style={{ backgroundImage: assetBg(view.bgAsset) }}
      onClick={clearSelection}
      onContextMenu={(e) => e.preventDefault()} // long-press is our discover gesture, not a context menu
    >
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
              onPointerDown={(e) => startHold(h.id, e)}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onPointerCancel={endHold}
              onClick={(e) => onTap(h.id, e)}
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

      <button className="bag-button" onClick={(e) => { e.stopPropagation(); toggleInventory() }} aria-label={t('ui.inventory.title')}>
        🎒
      </button>
    </div>
  )
}
