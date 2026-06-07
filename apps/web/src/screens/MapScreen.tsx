import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectMap } from '../selectors'
import { Hud } from '../components/Hud'

// Clean parchment-map glyphs (type at a glance): danger, rest, shop, event, home, waypoint.
const NODE_GLYPH: Record<string, string> = {
  entrance: '✦',
  combat: '!',
  elite: '!',
  boss: '‡',
  shop: '$',
  fireplace: '+',
  rest: '+',
  event: '?',
  scene: '⌂',
  explore: '⌂',
  waypoint: '•',
  secret: '✦',
}

const CELL_X = 200
const CELL_Y = 155
const PAD = 130
// node/figure are centred by offsetting half their size (NOT a CSS transform — Framer Motion owns
// `transform` for the hover-scale / walk tweens, and a CSS translate would be clobbered).
const NODE = 64
const TOKEN = 50
const WALK_MS = 820 // how long the figure walks a trail before the move is committed

// stable per-edge curve direction so the mesh reads as organic arcs, never a straight grid
const hash = (s: string) => {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

// the control point of the gentle arc between two node centres (shared by edges + the travelling figure)
const ctrlOf = (a: { x: number; y: number }, b: { x: number; y: number }, id: string) => {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const sign = hash(id) & 1 ? 1 : -1
  const k = 0.16 * len * sign
  return { x: mx + (-dy / len) * k, y: my + (dx / len) * k }
}

// gold (open to you) draws last, on top of the trodden/untrodden web
const EDGE_Z: Record<string, number> = { untrodden: 0, trodden: 1, gated: 2, gold: 3 }

type Travel = { from: string; to: string; firstVisit: boolean }

export function MapScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectMap(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const abandon = useGame((s) => s.abandon)
  const currentRef = useRef<HTMLButtonElement | null>(null)
  const [travel, setTravel] = useState<Travel | null>(null)
  const [confirmAbandon, setConfirmAbandon] = useState(false)

  // center the current node when the map opens / the hero arrives somewhere new
  const currentId = view?.nodes.find((n) => n.current)?.id
  useEffect(() => {
    if (!travel) currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [currentId, travel])

  // A TIMER — not the animation callback — commits the move once the figure has walked the trail.
  // This is the single source of truth, so a missed/duplicated framer onAnimationComplete (StrictMode
  // remount, AnimatePresence layer reuse) can never leave `travel` stuck and freeze the whole map.
  useEffect(() => {
    if (!travel) return
    const { to, firstVisit } = travel
    const id = window.setTimeout(() => {
      dispatch({ type: 'world/move', target: to })
      if (firstVisit) dispatch({ type: 'world/enter' }) // first arrival opens the node; a revisit waits for a click
      setTravel(null)
    }, WALK_MS)
    return () => window.clearTimeout(id)
  }, [travel, dispatch])

  if (!view) return null
  const W = view.bounds.w * CELL_X + PAD * 2
  const H = view.bounds.h * CELL_Y + PAD * 2
  const px = (p: { x: number; y: number }) => ({ x: PAD + p.x * CELL_X, y: PAD + p.y * CELL_Y })

  const arc = (ea: { x: number; y: number }, eb: { x: number; y: number }, id: string) => {
    const a = px(ea)
    const b = px(eb)
    const c = ctrlOf(a, b, id)
    return `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`
  }

  const edges = [...view.edges].sort((p, q) => (EDGE_Z[p.kind] ?? 0) - (EDGE_Z[q.kind] ?? 0))
  const currentNode = view.nodes.find((n) => n.current)
  const base = currentNode ? px(currentNode.pos) : { x: 0, y: 0 }

  // the figure walks one edge: keyframe its translate along the matching arc, then commit the move.
  const walk = (() => {
    if (!travel || !currentNode) return null
    const to = view.nodes.find((n) => n.id === travel.to)
    if (!to) return null
    const fromPx = px(currentNode.pos)
    const toPx = px(to.pos)
    // build the control point in the SAME canonical (sorted) order the edge is drawn with, so the
    // figure follows the identical line whichever way it travels — no mirrored return path.
    const [idA, idB] = [travel.from, travel.to].sort()
    const c = idA === currentNode.id ? ctrlOf(fromPx, toPx, `${idA}__${idB}`) : ctrlOf(toPx, fromPx, `${idA}__${idB}`)
    return { x: [0, c.x - fromPx.x, toPx.x - fromPx.x], y: [0, c.y - fromPx.y, toPx.y - fromPx.y] }
  })()

  const onNodeClick = (n: (typeof view.nodes)[number]) => {
    if (travel) return
    if (n.current) {
      if (n.enterable) dispatch({ type: 'world/enter' })
      return
    }
    if (!n.movable || !currentId) return
    setTravel({ from: currentId, to: n.id, firstVisit: !n.visited })
  }

  return (
    <div className="screen map">
      <Hud />
      <div className="map-scroll">
        <div className={`map-canvas${travel ? ' traveling' : ''}`} style={{ width: W, height: H }}>
          <svg className="map-edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
            {edges.map((e) => (
              <path key={e.id} d={arc(e.a, e.b, e.id)} className={`edge ${e.kind}`} />
            ))}
          </svg>

          {view.nodes.map((n) => {
            const p = px(n.pos)
            const clickable = !travel && (n.movable || n.enterable)
            // mutually-exclusive ring state: current (gold) wins, else travel target (teal), else locked
            const stateClass = n.current ? 'current' : n.movable && !travel ? 'movable' : 'locked'
            return (
              <motion.button
                key={n.id}
                ref={n.current ? currentRef : undefined}
                className={['map-node', `t-${n.type}`, stateClass, n.cleared ? 'cleared' : ''].join(' ')}
                style={{ left: p.x - NODE / 2, top: p.y - NODE / 2 }}
                onClick={() => onNodeClick(n)}
                disabled={!clickable}
                whileHover={clickable ? { scale: 1.09 } : undefined}
                animate={n.enterable && !travel ? { boxShadow: ['0 0 0 0 rgba(244,231,161,0)', '0 0 22px 5px rgba(244,231,161,0.55)', '0 0 0 0 rgba(244,231,161,0)'] } : {}}
                transition={n.enterable && !travel ? { repeat: Infinity, duration: 2.4 } : { duration: 0.2 }}
              >
                <span className="node-disc" style={{ backgroundImage: assetBg(n.bgAsset) }} />
                <span className="node-glyph">{NODE_GLYPH[n.type] ?? '•'}</span>
                <span className="node-label">{t(n.nameKey)}</span>
              </motion.button>
            )
          })}

          {/* the pilgrim's figure — a board-game pawn that walks the trail */}
          {currentNode && (
            <motion.div
              className="player-token"
              style={{ left: base.x - TOKEN / 2, top: base.y - TOKEN / 2 }}
              initial={false}
              animate={walk ? { x: walk.x, y: walk.y } : { x: 0, y: 0 }}
              transition={walk ? { duration: WALK_MS / 1000 - 0.04, ease: 'easeInOut', times: [0, 0.5, 1] } : { duration: 0 }}
            >
              <span className="player-pawn">♟</span>
            </motion.div>
          )}
        </div>
      </div>

      <footer className="map-footer">
        <span className="muted small">{t('ui.map.legend')}</span>
        {confirmAbandon ? (
          <span className="row gap">
            <span className="muted small">{t('ui.map.abandonConfirm')}</span>
            <button className="btn danger small" onClick={() => void abandon()}>{t('ui.common.yes')}</button>
            <button className="btn small" onClick={() => setConfirmAbandon(false)}>{t('ui.common.no')}</button>
          </span>
        ) : (
          <button className="btn danger small" onClick={() => setConfirmAbandon(true)}>
            {t('ui.map.abandon')}
          </button>
        )}
      </footer>
    </div>
  )
}
