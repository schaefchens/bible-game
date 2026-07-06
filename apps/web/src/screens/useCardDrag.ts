import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate, useMotionValue, type MotionValue } from 'framer-motion'
import { DESIGN_W, DESIGN_H } from '../lib/appHeight'
import { viewportToStage } from '../lib/stageCoords'
import type { HandCardView } from '../selectors'

// Card-attack animation (pure feel — no gameplay impact; the same combat/playCard runs either way).
// Shared by two input paths:
//  • DRAG: a press that moves starts AIMING — the card stays in the hand (highlighted) and a targeting
//    arrow is dragged to the cursor; releasing over a target slings the card in. Throw speed scales with
//    how fast the gesture was.
//  • CLICK: select a card then click a target — `sling()` plays the identical arc throw at a fixed speed.
// Either way the card flies from the hand along an arc and resolves ON LANDING, so the target's damage
// reaction lands in sync with the hit. A press that never moves is a tap → the normal click/select flow.

const DRAG_THRESHOLD = 8 // px of movement before a press counts as a drag
const CARD_W = 140 // matches the scaled .hand-fan/.card-ghost width in styles.css (keeps the slingshot copy centred)
const CARD_H = 199
// release Y above this fraction of the viewport counts as "in the field" (for self/non-targeted cards)
const FIELD_FRACTION = 0.72
const CLICK_DUR = 0.32 // fixed flight time for a click-targeted play (no flick velocity to scale from)

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
  /** play the slingshot for a click-targeted card (same animation as a drag) */
  sling: (card: HandCardView, targetId: string) => void
  setHandlers: (h: CardDragHandlers) => void
  /** the card currently being aimed (kept in hand, highlighted) */
  aimingIid: string | null
  /** the card whose copy is mid-flight — hide it in the hand (drag OR click) */
  launchedIid: string | null
  /** the live unit (enemy OR party member) currently under the aim cursor — drives the drop highlight */
  hoveredTargetId: string | null
  /** the targeting arrow while aiming (null once released / slingshotting) */
  aim: { from: { x: number; y: number }; x: MotionValue<number>; y: MotionValue<number>; valid: boolean } | null
  /** a card-copy slinging from the hand into the target after release */
  ghost: { card: HandCardView; x: MotionValue<number>; y: MotionValue<number>; scale: MotionValue<number>; opacity: MotionValue<number>; rotate: MotionValue<number> } | null
  /** a transient impact burst at the spot the slung card lands */
  impact: { x: number; y: number; seq: number } | null
}

// Positions below are returned in STAGE DESIGN space (the aim arrow / ghost render inside the scaled
// .stage). enemyAt stays in viewport space — document.elementFromPoint hit-tests against the real
// (post-transform) layout, so it takes the raw pointer coordinates.

// The faction a single-target card must be dropped on: enemy cards hit an enemy, `ally` support cards
// (heal/shield a teammate) hit a party member. Everything else (self/allAllies/allEnemies/none) has no
// chosen unit — it plays on a "field" release, not by dropping on a specific combatant.
type TargetFaction = 'enemy' | 'party'
function targetFactionOf(card: HandCardView): TargetFaction | null {
  if (card.target === 'enemy') return 'enemy'
  if (card.target === 'ally') return 'party'
  return null
}

// the LIVE unit of `faction` under a point (dead units keep their slot but are skipped as drop targets)
function unitAt(clientX: number, clientY: number, faction: TargetFaction): string | null {
  const el = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest('[data-cid]') as HTMLElement | null
  if (!el || el.dataset.faction !== faction || el.classList.contains('dead')) return null
  return el.dataset.cid ?? null
}

function centerOf(cid: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-cid="${cid}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return viewportToStage(r.left + r.width / 2, r.top + r.height / 2)
}

// the hand card's on-screen anchor — 'top' for the arrow origin, 'center' for the slingshot start
function cardAnchor(iid: string, which: 'top' | 'center'): { x: number; y: number } | null {
  const el = document.querySelector(`[data-iid="${iid}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return viewportToStage(r.left + r.width / 2, which === 'top' ? r.top + 8 : r.top + r.height / 2)
}

export function useCardDrag(): CardDrag {
  const aimX = useMotionValue(0) // cursor (arrow head) while aiming
  const aimY = useMotionValue(0)
  const ghostX = useMotionValue(0) // slingshot copy position after release
  const ghostY = useMotionValue(0)
  const ghostScale = useMotionValue(1)
  const ghostOpacity = useMotionValue(1)
  const ghostRotate = useMotionValue(0)
  const ghostProgress = useMotionValue(0) // 0→1 drives the arced flight path
  const [aiming, setAiming] = useState<{ iid: string; card: HandCardView; from: { x: number; y: number } } | null>(null)
  const [ghostCard, setGhostCard] = useState<HandCardView | null>(null)
  const [launchedIid, setLaunchedIid] = useState<string | null>(null)
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null)
  const [impact, setImpact] = useState<{ x: number; y: number; seq: number } | null>(null)
  const impactSeqRef = useRef(0)
  const hRef = useRef<CardDragHandlers>({ enabled: false, reduced: false, isPlayable: () => false, playCard: () => {}, onTap: () => {} })
  const cleanupRef = useRef<(() => void) | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  // On unmount (e.g. combat ends mid-drag) drop active listeners and block late setState callbacks.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cleanupRef.current?.()
    }
  }, [])

  const clearGhost = () => {
    if (!mountedRef.current) return
    setGhostCard(null)
    setLaunchedIid(null)
    setAiming(null)
  }

  // Shared launcher: fly a copy of the card from `src` to `dest` along an arc, spinning + receding, and
  // resolve the play ON LANDING (so the target reacts in sync with the hit), then smash + burst.
  const fly = (card: HandCardView, src: { x: number; y: number }, dest: { x: number; y: number }, dur: number, targetId?: string) => {
    const dist = Math.hypot(dest.x - src.x, dest.y - src.y)
    const ctrl = { x: (src.x + dest.x) / 2, y: Math.min(src.y, dest.y) - Math.min(180, dist * 0.34) } // bow up
    const spin = (dest.x >= src.x ? 1 : -1) * 360
    ghostX.set(src.x - CARD_W / 2)
    ghostY.set(src.y - CARD_H / 2)
    ghostScale.set(1)
    ghostOpacity.set(1)
    ghostRotate.set(0)
    ghostProgress.set(0)
    setLaunchedIid(card.iid) // hide the source card in the hand while its copy flies
    setGhostCard(card)
    if (hRef.current.reduced) {
      hRef.current.playCard(card, targetId)
      return clearGhost()
    }
    const onProgress = () => {
      const t = ghostProgress.get()
      const mt = 1 - t
      ghostX.set(mt * mt * src.x + 2 * mt * t * ctrl.x + t * t * dest.x - CARD_W / 2)
      ghostY.set(mt * mt * src.y + 2 * mt * t * ctrl.y + t * t * dest.y - CARD_H / 2)
      ghostRotate.set(spin * t)
      ghostScale.set(1 - 0.46 * t) // recede toward the target as it flies
    }
    const unsub = ghostProgress.on('change', onProgress)
    animate(ghostProgress, 1, {
      duration: dur,
      ease: [0.4, 0, 1, 1], // accelerate the whole way → drive into the target
      onComplete: () => {
        unsub()
        if (!mountedRef.current) return
        hRef.current.playCard(card, targetId) // resolve on impact → damage reaction syncs with the hit
        setImpact({ x: dest.x, y: dest.y, seq: ++impactSeqRef.current })
        // smash: a hard final shrink + fade on contact
        animate(ghostScale, 0.3, { duration: 0.09, ease: 'easeOut' })
        animate(ghostOpacity, 0, { duration: 0.12, ease: 'easeOut', onComplete: clearGhost })
      },
    })
  }

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
    let peak = 0 // peak drag speed (px/s) over the gesture — scales the throw, not the release instant
    let aimFrom: { x: number; y: number } | null = null

    const setHovered = (id: string | null) => {
      if (id !== hoveredRef.current) {
        hoveredRef.current = id
        setHoveredTargetId(id)
      }
    }
    const targetFaction = targetFactionOf(card)

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      cleanupRef.current = null
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
        aimFrom = cardAnchor(card.iid, 'top') ?? viewportToStage(ev.clientX, ev.clientY)
        const a0 = viewportToStage(ev.clientX, ev.clientY)
        aimX.set(a0.x)
        aimY.set(a0.y)
        setAiming({ iid: card.iid, card, from: aimFrom })
      }
      const a = viewportToStage(ev.clientX, ev.clientY)
      aimX.set(a.x)
      aimY.set(a.y)
      const now = performance.now()
      const dt = now - lastT
      if (dt > 0) {
        vx = vx * 0.6 + ((ev.clientX - lastX) / dt) * 1000 * 0.4
        vy = vy * 0.6 + ((ev.clientY - lastY) / dt) * 1000 * 0.4
        peak = Math.max(peak, Math.hypot(vx, vy))
        lastX = ev.clientX
        lastY = ev.clientY
        lastT = now
      }
      setHovered(targetFaction ? unitAt(ev.clientX, ev.clientY, targetFaction) : null)
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
      // single-target cards (enemy / ally) must land on a live unit of the right faction; others (self,
      // allAllies, allEnemies) play on a "field" release above FIELD_FRACTION.
      const targetId = targetFaction ? unitAt(releaseX, releaseY, targetFaction) : null
      const valid = targetFaction ? !!targetId : releaseY < window.innerHeight * FIELD_FRACTION
      if (!valid) {
        setAiming(null) // cancel — the card un-highlights; nothing is played
        return
      }
      const releaseStage = viewportToStage(releaseX, releaseY)
      const src = cardAnchor(card.iid, 'center') ?? aimFrom ?? releaseStage
      const dest = (targetId && centerOf(targetId)) || { x: releaseStage.x, y: releaseStage.y - 220 }
      // throw time from the PEAK gesture speed (people decelerate to aim, so the release instant is ~0):
      // a slow drag lobs (~0.42s), a hard flick snaps (~0.22s, not blink-fast).
      const fast = Math.min(1, Math.max(0, (peak - 600) / 2400))
      fly(card, src, dest, 0.42 - 0.2 * fast, targetId ?? undefined)
    }

    const onCancel = () => {
      cleanup()
      setAiming(null)
    }

    cleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }

  const sling = (card: HandCardView, targetId: string) => {
    if (!mountedRef.current) return
    const src = cardAnchor(card.iid, 'center') ?? { x: DESIGN_W / 2, y: DESIGN_H - 120 }
    const dest = centerOf(targetId) ?? { x: DESIGN_W / 2, y: DESIGN_H / 2 }
    fly(card, src, dest, CLICK_DUR, targetId)
  }

  return {
    beginDrag,
    sling,
    setHandlers: (h) => {
      hRef.current = h
    },
    aimingIid: aiming?.iid ?? null,
    launchedIid,
    hoveredTargetId,
    aim:
      aiming && !ghostCard
        ? {
            from: aiming.from,
            x: aimX,
            y: aimY,
            // single-target cards need a valid unit under the cursor; field cards are always valid
            valid: targetFactionOf(aiming.card) ? hoveredTargetId != null : true,
          }
        : null,
    ghost: ghostCard ? { card: ghostCard, x: ghostX, y: ghostY, scale: ghostScale, opacity: ghostOpacity, rotate: ghostRotate } : null,
    impact,
  }
}
