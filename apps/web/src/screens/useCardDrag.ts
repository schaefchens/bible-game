import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate, useMotionValue, type MotionValue } from 'framer-motion'
import type { HandCardView } from '../selectors'

// Drag-and-drop card play (pure feel — no gameplay impact; the same combat/playCard runs either way).
// A press that moves past a threshold becomes a drag: a "ghost" card follows the cursor. Releasing
// over a valid target plays the card and slings the ghost toward it — the faster the flick at release,
// the faster the slingshot. A press WITHOUT movement is a tap and falls back to the normal click flow.

const DRAG_THRESHOLD = 8 // px of movement before a press counts as a drag
const CARD_W = 114 // matches .card width in styles.css (keeps the ghost centred under the cursor)
const CARD_H = 162
// release Y above this fraction of the viewport counts as "in the field" (for self/non-targeted cards)
const FIELD_FRACTION = 0.72

export interface CardDragHandlers {
  enabled: boolean
  reduced: boolean
  /** only playable (affordable, not clutter) cards may be dragged; others stay tap-only */
  isPlayable: (card: HandCardView) => boolean
  /** resolve the card (dispatch combat/playCard); targetId only for single-enemy cards */
  playCard: (card: HandCardView, targetId?: string) => void
  /** a press that never moved — run the normal click/select flow */
  onTap: (card: HandCardView) => void
}

export interface CardDrag {
  beginDrag: (e: ReactPointerEvent, card: HandCardView) => void
  setHandlers: (h: CardDragHandlers) => void
  draggingIid: string | null
  hoveredEnemyId: string | null
  ghost: { card: HandCardView; x: MotionValue<number>; y: MotionValue<number> } | null
}

// the enemy under a point — only a LIVE enemy unit counts (dead units keep their slot but are skipped)
function enemyAt(x: number, y: number): string | null {
  const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest('[data-cid]') as HTMLElement | null
  if (!el || el.dataset.faction !== 'enemy' || el.classList.contains('dead')) return null
  return el.dataset.cid ?? null
}

function centerOf(cid: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-cid="${cid}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

export function useCardDrag(): CardDrag {
  const ghostX = useMotionValue(0)
  const ghostY = useMotionValue(0)
  const [ghostCard, setGhostCard] = useState<HandCardView | null>(null)
  const [draggingIid, setDraggingIid] = useState<string | null>(null)
  const [hoveredEnemyId, setHoveredEnemyId] = useState<string | null>(null)
  const hRef = useRef<CardDragHandlers>({ enabled: false, reduced: false, isPlayable: () => false, playCard: () => {}, onTap: () => {} })
  const cleanupRef = useRef<(() => void) | null>(null) // tears down the active drag's window listeners
  const hoveredRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  // On unmount (e.g. combat ends mid-drag), drop any active listeners and block late setState callbacks.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanupRef.current?.()
    }
  }, [])

  const beginDrag = (e: ReactPointerEvent, card: HandCardView) => {
    if (!hRef.current.enabled || e.button !== 0) return
    cleanupRef.current?.() // recover from any stale drag whose pointerup/cancel was missed
    const downX = e.clientX
    const downY = e.clientY
    let moved = false
    let lastX = downX
    let lastY = downY
    let lastT = performance.now()
    let vx = 0
    let vy = 0

    const setHovered = (id: string | null) => {
      if (id !== hoveredRef.current) {
        hoveredRef.current = id
        setHoveredEnemyId(id)
      }
    }

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      cleanupRef.current = null
    }

    const settleGhost = (toX: number, toY: number, dur: number, ease: 'easeIn' | 'easeOut') => {
      const done = () => {
        if (!mountedRef.current) return
        setGhostCard(null)
        setDraggingIid(null)
      }
      if (hRef.current.reduced) return done()
      animate(ghostX, toX, { duration: dur, ease })
      animate(ghostY, toY, { duration: dur, ease, onComplete: done })
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - downX
      const dy = ev.clientY - downY
      if (!moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        // hone/cast-off cards open a modal, clutter can't be played, and unaffordable cards would only
        // fizzle — all stay tap-only (a tap runs the normal select/click flow on release)
        if (card.pick || card.unplayable || !hRef.current.isPlayable(card)) return
        moved = true
        ghostX.set(ev.clientX - CARD_W / 2)
        ghostY.set(ev.clientY - CARD_H / 2)
        setGhostCard(card)
        setDraggingIid(card.iid)
      }
      ghostX.set(ev.clientX - CARD_W / 2)
      ghostY.set(ev.clientY - CARD_H / 2)
      const now = performance.now()
      const dt = now - lastT
      if (dt > 0) {
        vx = vx * 0.6 + ((ev.clientX - lastX) / dt) * 1000 * 0.4
        vy = vy * 0.6 + ((ev.clientY - lastY) / dt) * 1000 * 0.4
        lastX = ev.clientX
        lastY = ev.clientY
        lastT = now
      }
      setHovered(card.target === 'enemy' ? enemyAt(ev.clientX, ev.clientY) : null)
    }

    const onUp = (ev: PointerEvent) => {
      cleanup()
      if (!moved) {
        hRef.current.onTap(card)
        return
      }
      setHovered(null)
      const releaseX = ev.clientX
      const releaseY = ev.clientY
      const needsEnemy = card.target === 'enemy'
      const enemyId = needsEnemy ? enemyAt(releaseX, releaseY) : null
      const valid = needsEnemy ? !!enemyId : releaseY < window.innerHeight * FIELD_FRACTION
      if (!valid) {
        // cancel — drift the ghost back toward the release point and fade
        settleGhost(releaseX - CARD_W / 2, releaseY - CARD_H / 2 + 30, 0.16, 'easeOut')
        return
      }
      // cache the slingshot destination BEFORE resolving the card (the DOM may change on dispatch)
      const dest = (enemyId && centerOf(enemyId)) || { x: releaseX, y: releaseY - 220 }
      const fromX = ghostX.get()
      const fromY = ghostY.get()
      const dist = Math.hypot(dest.x - CARD_W / 2 - fromX, dest.y - CARD_H / 2 - fromY)
      const speed = Math.hypot(vx, vy) // px/s flick speed at release
      const slingSpeed = Math.max(1400, speed * 1.6) // faster flick → faster slingshot
      const dur = Math.min(0.4, Math.max(0.07, dist / slingSpeed))
      hRef.current.playCard(card, enemyId ?? undefined) // identical to a click-play (no gameplay impact)
      settleGhost(dest.x - CARD_W / 2, dest.y - CARD_H / 2, dur, 'easeIn')
    }

    const onCancel = () => {
      cleanup()
      if (moved) settleGhost(ghostX.get(), ghostY.get(), 0.12, 'easeOut')
    }

    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  return {
    beginDrag,
    setHandlers: (h) => {
      hRef.current = h
    },
    draggingIid,
    hoveredEnemyId,
    ghost: ghostCard ? { card: ghostCard, x: ghostX, y: ghostY } : null,
  }
}
