import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import type { GameEvent } from '@bible/engine'
import { assetBg } from '@bible/assets'
import { bgUrl } from '../asset'
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

// gold (open to you) draws last, on top of the trodden/untrodden web; sealed/gated sit above trails
const EDGE_Z: Record<string, number> = { untrodden: 0, trodden: 1, gated: 2, sealed: 2.5, gold: 3 }

// legend key: node-type glyphs (colour from the .lg-glyph.t-* rules) + the four trail kinds
const NODE_LEGEND = [
  { glyph: '+', cls: 't-rest', key: 'ui.map.legend.rest' },
  { glyph: '!', cls: 't-combat', key: 'ui.map.legend.combat' },
  { glyph: '‡', cls: 't-boss', key: 'ui.map.legend.boss' },
  { glyph: '$', cls: 't-shop', key: 'ui.map.legend.shop' },
  { glyph: '?', cls: 't-event', key: 'ui.map.legend.event' },
  { glyph: '•', cls: 't-waypoint', key: 'ui.map.legend.waypoint' },
] as const
const TRAIL_LEGEND = [
  { kind: 'gold', key: 'ui.map.legend.open' },
  { kind: 'trodden', key: 'ui.map.legend.trodden' },
  { kind: 'untrodden', key: 'ui.map.legend.untrodden' },
  { kind: 'gated', key: 'ui.map.legend.gated' },
  { kind: 'sealed', key: 'ui.map.legend.sealed' },
] as const
type Travel = { from: string; to: string; firstVisit: boolean }
// a one-shot arrival the player did NOT click: a scene's "Go to" already relocated the pilgrim here,
// so we replay the walk (or a fade-in) for feedback without dispatching anything.
type Arrival = { from: string; to: string }

export function MapScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectMap(state), [state])
  // faint region bands are per-map content (short maps like the tutorial define none)
  const regions = useMemo(() => {
    const m = state.run ? state.run.content.worlds[state.run.worldId]?.map : undefined
    return m?.regions ?? []
  }, [state])
  const dispatch = useGame((s) => s.dispatch)
  const lastEvents = useGame((s) => s.lastEvents)
  const tick = useGame((s) => s.tick)
  const currentRef = useRef<HTMLButtonElement | null>(null)
  const [travel, setTravel] = useState<Travel | null>(null)
  const [arrival, setArrival] = useState<Arrival | null>(null)
  const [legendOpen, setLegendOpen] = useState(false) // the legend key starts collapsed to save space
  // a transient line of feedback (e.g. "this battle bars the way") that fades after a moment
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const id = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(id)
  }, [notice])

  // A scene "Go to" reveals a hidden node and relocates the pilgrim in one engine step — its event
  // batch carries BOTH `nodeRevealed` and `moved` (normal travel never reveals). Detect that batch
  // (once per tick, in layout phase to avoid a flash at the destination) and replay the arrival walk
  // + flash a discovery banner. Plain `revealNode` (reveal without travel) only flashes the banner.
  const arrivalTick = useRef(-1)
  useLayoutEffect(() => {
    if (arrivalTick.current === tick) return
    arrivalTick.current = tick
    const revealed = lastEvents.some((e) => e.type === 'nodeRevealed')
    if (!revealed) return
    setNotice(t('ui.map.discovered'))
    const moved = lastEvents.find((e): e is Extract<GameEvent, { type: 'moved' }> => e.type === 'moved')
    if (moved && moved.from !== moved.to) setArrival({ from: moved.from, to: moved.to })
  }, [tick, lastEvents, t])
  useEffect(() => {
    if (!arrival) return
    const id = window.setTimeout(() => setArrival(null), WALK_MS)
    return () => window.clearTimeout(id)
  }, [arrival])

  // center the focus node when the map opens / the hero arrives somewhere new. Before placement we
  // focus the first entry marker so the player sees where they can begin.
  const currentId = view?.nodes.find((n) => n.current)?.id
  const focusId = currentId ?? view?.nodes.find((n) => n.entry)?.id
  useEffect(() => {
    if (!travel) currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  }, [focusId, travel])

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

  // a script-driven arrival (Go to): the figure is already AT `to`, so replay the walk in reverse —
  // start offset at `from`, animate to 0. Only when both ends are on-screen and a trail connects them
  // (else we fade the figure in at the destination, for a secret jump with no drawn path).
  const arrivalWalk = (() => {
    if (!arrival || !currentNode || currentNode.id !== arrival.to) return null
    const [idA, idB] = [arrival.from, arrival.to].sort()
    const a = view.nodes.find((n) => n.id === idA)
    const b = view.nodes.find((n) => n.id === idB)
    const hasEdge = view.edges.some((e) => e.id === `${idA}__${idB}`)
    if (!a || !b || !hasEdge) return null
    const aPx = px(a.pos)
    const bPx = px(b.pos)
    const c = ctrlOf(aPx, bPx, `${idA}__${idB}`)
    const toPx = px(currentNode.pos)
    const seq = arrival.from === idA ? [aPx, c, bPx] : [bPx, c, aPx] // traverse the bezier from→to
    return { x: seq.map((p) => p.x - toPx.x), y: seq.map((p) => p.y - toPx.y) }
  })()

  const walkTween = { duration: WALK_MS / 1000 - 0.04, ease: 'easeInOut' as const, times: [0, 0.5, 1] }
  // one place that decides how the pawn renders this frame: click-walk, arrival-walk, arrival-fade, idle
  const figure = walk
    ? { key: 'pawn', initial: false as const, animate: { x: walk.x, y: walk.y }, transition: walkTween }
    : arrivalWalk
      ? { key: `arr-${arrival!.to}`, initial: { x: arrivalWalk.x[0], y: arrivalWalk.y[0] }, animate: { x: arrivalWalk.x, y: arrivalWalk.y }, transition: walkTween }
      : arrival
        ? { key: `arr-${arrival.to}`, initial: { opacity: 0, scale: 0.5 }, animate: { opacity: 1, scale: 1, x: 0, y: 0 }, transition: { duration: 0.45 } }
        : { key: 'pawn', initial: false as const, animate: { x: 0, y: 0 }, transition: { duration: 0 } }

  // a sealed edge (onward route barred by the uncleared battle underfoot) touches the current node;
  // its id is the two endpoint ids joined — so we can tell whether a click target sits behind one.
  const sealedToward = (id: string) => view.edges.some((e) => e.kind === 'sealed' && e.id.split('__').includes(id))

  const onNodeClick = (n: (typeof view.nodes)[number]) => {
    if (travel) return
    // before placement, the only legal action is choosing one of the marked entry points —
    // choosing one places the pilgrim AND enters it straight away (no extra click), like a first arrival
    if (view.unplaced) {
      if (n.entry) {
        dispatch({ type: 'world/chooseEntry', nodeId: n.id })
        dispatch({ type: 'world/enter' })
      }
      return
    }
    if (n.current) {
      if (n.enterable) dispatch({ type: 'world/enter' })
      return
    }
    if (!n.movable || !currentId) {
      if (sealedToward(n.id)) setNotice(t('ui.map.sealedNotice'))
      return
    }
    setTravel({ from: currentId, to: n.id, firstVisit: !n.visited })
  }

  const visited = view.nodes.filter((n) => n.visited).length

  return (
    <div className="screen map">
      <Hud />

      {/* title cartouche (world name), fixed under the HUD — keyed off the active world */}
      <div className="map-cartouche">{t(`ui.worldSelect.${(state.run?.worldId ?? 'world-01').replace('-', '')}.title`)}</div>

      {/* guidance + transient feedback banners (centred under the cartouche) */}
      {view.unplaced && <div className="map-banner guide">{t('ui.map.chooseEntry')}</div>}
      {notice && <div className="map-banner notice">{notice}</div>}

      <div className="map-scroll">
        <div className={`map-canvas${travel ? ' traveling' : ''}`} style={{ width: W, height: H, '--map-tile': bgUrl('bg-map-parchment.png') } as CSSProperties}>
          <svg className="map-edges" width={W} height={H} viewBox={`0 0 ${W} ${H}`} fill="none">
            {edges.map((e) => (
              <path key={e.id} d={arc(e.a, e.b, e.id)} className={`edge ${e.kind}`} />
            ))}
          </svg>

          {/* faint region names on the parchment (scroll with the map, behind the nodes) */}
          {regions.map((r) => {
            const p = px({ x: r.x, y: -0.05 })
            return (
              <span key={r.key} className="map-region" style={{ left: p.x, top: p.y }}>{t(r.key)}</span>
            )
          })}

          {view.nodes.map((n) => {
            const p = px(n.pos)
            const actionable = !travel && (n.movable || n.enterable || n.entry)
            // a barred node isn't reachable, but stays clickable so a tap explains *why* (sealed notice)
            const clickable = actionable || (!travel && sealedToward(n.id))
            // mutually-exclusive ring state: current (gold) wins, then an entry marker, then a travel
            // target (teal), else locked
            const stateClass = n.current ? 'current' : n.entry ? 'entry' : n.movable && !travel ? 'movable' : 'locked'
            const pulse = (n.enterable || n.entry) && !travel
            return (
              <motion.button
                key={n.id}
                ref={n.id === focusId ? currentRef : undefined}
                className={['map-node', `t-${n.type}`, stateClass, n.cleared ? 'cleared' : ''].join(' ')}
                style={{ left: p.x - NODE / 2, top: p.y - NODE / 2 }}
                onClick={() => onNodeClick(n)}
                disabled={!clickable}
                whileHover={actionable ? { scale: 1.09 } : undefined}
                animate={pulse ? { boxShadow: ['0 0 0 0 rgba(244,231,161,0)', '0 0 22px 5px rgba(244,231,161,0.55)', '0 0 0 0 rgba(244,231,161,0)'] } : {}}
                transition={pulse ? { repeat: Infinity, duration: 2.4 } : { duration: 0.2 }}
              >
                <span className="node-disc" style={{ backgroundImage: assetBg(n.bgAsset) }} />
                <span className="node-glyph">{NODE_GLYPH[n.type] ?? '•'}</span>
                <span className="node-label">{t(n.nameKey)}</span>
                {n.entry && <span className="node-entry-pin">{t('ui.map.startHere')}</span>}
              </motion.button>
            )
          })}

          {/* the pilgrim's figure — a board-game pawn that walks the trail */}
          {currentNode && (
            <motion.div
              key={figure.key}
              className="player-token"
              style={{ left: base.x - TOKEN / 2, top: base.y - TOKEN / 2 }}
              initial={figure.initial}
              animate={figure.animate}
              transition={figure.transition}
            >
              <span className="player-pawn">♟</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* legend key — node types + trail kinds + journey progress (collapsed by default to save space) */}
      <aside className={`map-legend${legendOpen ? '' : ' collapsed'}`}>
        <button className="lg-title" onClick={() => setLegendOpen((o) => !o)} aria-expanded={legendOpen}>
          <span className="lg-chevron">{legendOpen ? '▾' : '▸'}</span>
          {t('ui.map.legendTitle')}
        </button>
        {legendOpen && (
          <div className="lg-body">
            <div className="lg-rows">
              {NODE_LEGEND.map((r) => (
                <div className="lg-row" key={r.key}>
                  <span className={`lg-glyph ${r.cls}`}>{r.glyph}</span>
                  <span className="lg-label">{t(r.key)}</span>
                </div>
              ))}
            </div>
            <div className="lg-divider" />
            <div className="lg-rows">
              {TRAIL_LEGEND.map((r) => (
                <div className="lg-row" key={r.key}>
                  <svg className="lg-line" viewBox="0 0 40 6" width="40" height="6" fill="none">
                    <path d="M2 3 H38" className={`edge ${r.kind}`} />
                  </svg>
                  <span className="lg-label">{t(r.key)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="lg-progress">{t('ui.map.progress', { visited, total: view.nodes.length })}</div>
      </aside>

      {/* decorative compass rose (bottom-right) */}
      <div className="map-compass" aria-hidden="true">
        <svg viewBox="0 0 64 64" width="54" height="54">
          <g fill="var(--gold)" opacity="0.5">
            <polygon points="32,3 37,30 32,27 27,30" />
            <polygon points="61,32 34,37 37,32 34,27" />
            <polygon points="32,61 27,34 32,37 37,34" />
            <polygon points="3,32 30,27 27,32 30,37" />
          </g>
          <g fill="var(--gold)" opacity="0.28">
            <polygon points="50,14 35,29 33,27 31,25" />
            <polygon points="50,50 31,35 33,33 35,31" />
            <polygon points="14,50 29,31 27,33 25,35" />
            <polygon points="14,14 33,29 31,31 29,33" />
          </g>
          <circle cx="32" cy="32" r="2.6" fill="var(--gold-bright)" opacity="0.7" />
        </svg>
      </div>

    </div>
  )
}
