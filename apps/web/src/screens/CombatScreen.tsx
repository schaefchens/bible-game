import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { previewCardDamage } from '@bible/engine'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'
import { useSession } from '../store/useSession'
import { sendActivity } from '../net'
import { playerColor, playerSymbol } from '../lib/playerColors'
import { selectCombat, selectCombatPile, type CombatView, type CombatantView, type HandCardView } from '../selectors'
import { CardView } from '../components/Card'
import { CardFace } from '../components/CardFace'
import { AimPointer } from '../components/AimPointer'
import { Hud } from '../components/Hud'
import { CardListModal } from '../components/CardListModal'
import { CardPickModal, type PickSpec } from '../components/CardPickModal'
import { useCombatFeedback, type UnitFloat, type UnitReaction } from './useCombatFeedback'
import { useCardDrag, type CardDrag } from './useCardDrag'
import { spriteUrl, spriteEmoji, spriteScale } from '../sprites'

const INTENT_ICON: Record<string, string> = { attack: '⚔️', attackMulti: '⚔️', block: '🛡️', buff: '⬆️', debuff: '⬇️', clutter: '🌫️', special: '…', unknown: '❔' }
// chips for buffs/debuffs on a combatant (lastStand keeps its own badge). 'buff' = green, 'debuff' = red tint.
const STATUS_ICON: Record<string, string> = { strength: '💪', dexterity: '🤚', poison: '☠️', weak: '💢', vulnerable: '🎯', bound: '⛓️' }
const STATUS_KIND: Record<string, 'buff' | 'debuff'> = { strength: 'buff', dexterity: 'buff', poison: 'debuff', weak: 'debuff', vulnerable: 'debuff', bound: 'debuff' }
// persistent powers — gold chips, distinct from the buff/debuff status chips (match the card art)
const POWER_ICON: Record<string, string> = { steadfast: '🗿', menace: '😠', bulwark: '🏰', bastion: '🗼', momentum: '🌀', whetstone: '🔪', adrenaline: '⚡', fury: '🔥', aegis: '🛡️', warleader: '🚩' }

// A plain-language description of what an enemy's telegraphed intent will do, built from the localized
// kind label plus the live numbers/status — so hovering or tapping the intent pill explains the move
// (e.g. "Curses you: Vulnerable 2 — Takes 50% more damage. Wanes each round.").
function intentText(c: CombatantView, t: (key: string) => string): string {
  const k = c.intentKind
  if (!k) return ''
  const base = t(`intent.${k}`)
  if (k === 'attack') return c.intentValue ? `${base} — ${c.intentValue}` : base
  if (k === 'attackMulti') return c.intentValue ? `${base} — ${c.intentValue}×${c.intentHits ?? 1}` : base
  if (k === 'block') return c.intentValue ? `${base} — ${c.intentValue}` : base
  if (k === 'buff' || k === 'debuff') {
    if (!c.intentStatus) return base
    const amt = c.intentStacks ? ` ${c.intentStacks}` : ''
    return `${base}: ${t(`status.${c.intentStatus}.name`)}${amt} — ${t(`status.${c.intentStatus}.desc`)}`
  }
  return base
}

// An intent pill / symbol chip that explains itself: the tip shows on HOVER (mouse) and on TAP/CLICK
// (a pinned toggle — reliable on touch, where :focus on a non-button is flaky). Clicking inspects
// without also targeting the unit (stopPropagation). The host carries the visual class (.intent/.badge).
function Tip({ text, className, children }: { text: ReactNode; className: string; children: ReactNode }) {
  const [pinned, setPinned] = useState(false)
  return (
    <span
      className={`${className} tip-host${pinned ? ' pinned' : ''}`}
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); setPinned((p) => !p) }}
    >
      {children}
      <span className="intel-tip" role="tooltip">{text}</span>
    </span>
  )
}

// Pause between each enemy's action during the UI-paced enemy turn (one engine step per gap). Long
// enough to read the lunge → hit → HP-drop → damage float before the next foe steps up.
const ENEMY_STEP_GAP = 820

// The energy orb's colour scales with how full it is: a solid dark green at empty, gaining gold with
// each point until it glows golden at full. Interpolated (not stepped) so partial amounts read between.
function energyOrbStyle(current: number, max: number) {
  const t = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  const inner = `rgb(${mix(56, 246)}, ${mix(98, 232)}, ${mix(48, 166)})` // dark green → pale gold
  const outer = `rgb(${mix(10, 184)}, ${mix(30, 146)}, ${mix(9, 63)})` // very dark green → deep gold
  const border = `rgb(${mix(96, 244)}, ${mix(116, 231)}, ${mix(68, 161)})` // olive → gold-bright
  const glow = `rgba(${mix(90, 244)}, ${mix(175, 231)}, ${mix(80, 161)}, ${(0.15 + 0.6 * t).toFixed(2)})`
  return {
    background: `radial-gradient(circle at 36% 30%, ${inner}, ${outer} 72%)`,
    borderColor: border,
    boxShadow: `0 0 ${Math.round(14 + 26 * t)}px ${glow}, 0 0 0 1px rgba(0,0,0,0.4), inset 0 0 18px rgba(0,0,0,0.5), inset 0 6px 12px rgba(255,250,210,${(0.18 + 0.4 * t).toFixed(2)})`,
  }
}

// Live state the (register-once) keyboard handler reads at event time — published into a ref each
// render so the listener always sees the current hand/target/drag without re-subscribing per render.
interface KbState {
  view: CombatView | null
  aliveEnemies: CombatantView[]
  resolvedTargetId: string | null
  primaryPartyId: string | undefined
  drag: CardDrag
  reduced: boolean
  /** co-op: End Turn always sends the batch endTurn (the server drives the enemy turn) */
  mp: boolean
  /** a panel/overlay (deck, bag, item-carry, pile/pick modal, chat) owns the keys → battle hotkeys stand down */
  overlayOpen: boolean
}

export function CombatScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectCombat(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const aimItemAt = useGame((s) => s.aimItemAt)
  const clearItemInteraction = useGame((s) => s.clearItemInteraction)
  const deckOpen = useGame((s) => s.deckOpen)
  const inventoryOpen = useGame((s) => s.inventoryOpen)
  // Co-op: the SERVER drives combat progression (beginAction + the whole enemy turn), so the client's
  // auto-effects stand down and End Turn always sends the batch endTurn. The chat box owns the keyboard.
  const mpMode = useGame((s) => s.mpMode)
  const chatOpen = useSession((s) => s.chatOpen)
  const peers = useSession((s) => s.peers)
  const peerPicks = useSession((s) => s.peerPicks)
  const fb = useCombatFeedback()
  const drag = useCardDrag()
  const [pending, setPending] = useState<{ kind: 'card'; iid: string } | { kind: 'grace'; ability: string } | null>(null)
  // The persistently-selected enemy (active target): set by clicking/tapping an enemy or cycling with
  // Q/E / arrow keys, played onto by the number keys, and remembered across turns (this screen stays
  // mounted for the whole battle). Never trusted raw — `resolvedTargetId` re-derives a live target.
  const [activeTargetId, setActiveTargetId] = useState<string | null>(null)
  // a bottom-corner pile to inspect (read-only), and a "pick cards" prompt for hone/cast-off/prepare
  const [pileModal, setPileModal] = useState<'draw' | 'discard' | 'exhaust' | null>(null)
  const [pickModal, setPickModal] = useState<{ iid: string; pick: PickSpec } | null>(null)
  // a transient "Your Turn / Enemy Turn" banner, raised by the feedback hook's turn cue
  const [banner, setBanner] = useState<{ kind: 'party' | 'enemy'; seq: number } | null>(null)
  // co-op: which hand card the local player is hovering (relayed to teammates as presence)
  const [hoveredCardIid, setHoveredCardIid] = useState<string | null>(null)
  // true while the hand is being discarded at end-turn: the cards slide DOWN off the bottom edge
  // (vs. a single play, which keeps its fly-to-target / fly-up motion). Read by the hand's exit via
  // AnimatePresence `custom`; reset once the player is acting again with a fresh hand.
  const [handDiscarding, setHandDiscarding] = useState(false)

  // Screen shake (battlefield only — never the clickable hand) and the energy-orb spend pulse.
  const shakeControls = useAnimationControls()
  const energyControls = useAnimationControls()
  // Latest values for the keyboard handler (see KbState) — refreshed every render below.
  const kbRef = useRef<KbState>({ view: null, aliveEnemies: [], resolvedTargetId: null, primaryPartyId: undefined, drag, reduced: false, mp: false, overlayOpen: false })

  // Auto-begin the action phase each round: the engine opens combat (and every new round) in a brief
  // "decision" window before the hand is drawn — draw it automatically so the player never presses ▶.
  useEffect(() => {
    if (mpMode) return // co-op: the server enters the action phase for the party (settleCombat)
    if (view?.phase === 'partyDecision' && view.outcome === 'ongoing') dispatch({ type: 'combat/beginAction' })
  }, [view?.phase, view?.outcome, dispatch, mpMode])

  // The end-turn discard is over once the player is acting again (the fresh hand is dealt) — clear the
  // flag so the next card the player PLAYS flies to its target rather than dropping off the bottom.
  useEffect(() => {
    if (view?.phase === 'partyAction') setHandDiscarding(false)
  }, [view?.phase])

  useEffect(() => {
    if (fb.shake && !fb.reduced) void shakeControls.start({ x: [0, -6, 6, -4, 0], transition: { duration: 0.26 } })
  }, [fb.shake])
  useEffect(() => {
    if (fb.energyPulse && !fb.reduced) void energyControls.start({ scale: [1, 1.16, 1], transition: { duration: 0.3 } })
  }, [fb.energyPulse])
  useEffect(() => {
    if (!fb.turnCue) return
    setBanner(fb.turnCue)
    const id = setTimeout(() => setBanner(null), 950)
    return () => clearTimeout(id)
  }, [fb.turnCue?.seq])

  // Pace the stepped enemy turn: the engine resolves ONE enemy per `combat/advanceEnemyTurn`, so we
  // fire the next advance after a short gap and let each attack animate (lunge → hit → HP drop →
  // float) via the per-dispatch feedback path. The effect re-runs on each enemyStepIndex change,
  // walking the queue until the turn resolves (phase leaves 'enemyTurn'). The cleanup clears the
  // pending timer (unmount- and supersede-safe); the engine's own guard ignores any stray advance.
  // Reduced motion never enters this phase — its End Turn dispatches the instant batch `endTurn`.
  const enemyPhaseActive = state.combat?.phase === 'enemyTurn' && state.combat?.enemyQueue !== undefined
  const enemyStepIndex = state.combat?.enemyStepIndex
  useEffect(() => {
    if (mpMode) return // co-op: the server resolves the whole enemy turn (batch endTurn) and broadcasts
    if (!enemyPhaseActive) return
    const id = setTimeout(() => dispatch({ type: 'combat/advanceEnemyTurn' }), ENEMY_STEP_GAP)
    return () => clearTimeout(id)
  }, [enemyPhaseActive, enemyStepIndex, dispatch, mpMode])

  // Keyboard control of the battle. Registered ONCE (the listener reads live state from kbRef, so it
  // never re-subscribes as the hand/target change). dispatch + the useState setters are stable, so we
  // close over them directly. Keys: 1-9 play the hand card at that slot on the active target (Alt →
  // cast on the player, which is impossible for enemy-only cards → blocked); Q/E and ←/→ cycle the
  // active target; Enter or F ends the turn. Layered like GlobalHotkeys: it stands down for typing fields,
  // open panels/modals, an in-flight card, the enemy turn, and never swallows keys it doesn't consume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = kbRef.current
      if (!s.view) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      if (e.metaKey || e.ctrlKey) return // Alt is OURS (cast-on-player) — don't bail on it
      if (s.view.outcome !== 'ongoing') return
      if (s.overlayOpen || document.querySelector('.modal-overlay')) return // a panel/modal owns the keys
      if (s.drag.aimingIid || s.drag.ghost || s.drag.launchedIid) return // a card is mid-flight

      const key = e.key
      // Cycle the active target (kept across turns) — allowed any time it's our fight.
      if (key === 'q' || key === 'Q' || key === 'e' || key === 'E' || key === 'ArrowLeft' || key === 'ArrowRight') {
        const back = key === 'q' || key === 'Q' || key === 'ArrowLeft'
        const alive = s.aliveEnemies
        if (alive.length) {
          const cur = alive.findIndex((c) => c.id === s.resolvedTargetId)
          const next = alive[(((cur < 0 ? 0 : cur) + (back ? -1 : 1)) + alive.length) % alive.length]
          if (next) setActiveTargetId(next.id)
        }
        e.preventDefault()
        return
      }

      // The rest act only on the player's action turn.
      if (s.view.phase !== 'partyAction') return

      if (key === 'Enter' || key === 'f' || key === 'F') {
        if (e.repeat) return
        setHandDiscarding(true)
        // co-op + reduced motion both send the instant batch endTurn; otherwise hand off to the stepped turn
        dispatch({ type: s.mp || s.reduced ? 'combat/endTurn' : 'combat/beginEnemyTurn' })
        e.preventDefault()
        return
      }

      if (key >= '1' && key <= '9') {
        if (e.repeat) return // a held digit must not autofire the whole hand
        const card = s.view.hand[Number(key) - 1]
        if (!card || card.unplayable) return
        if (s.view.energy.current < card.cost) return // unaffordable → no-op (mirrors clickCard)
        if (card.pick) { setPending(null); setPickModal({ iid: card.iid, pick: card.pick }); e.preventDefault(); return }
        const enemyOnly = card.target === 'enemy' || card.target === 'allEnemies'
        if (e.altKey && enemyOnly) { e.preventDefault(); return } // can't cast an enemy-only card on the player → blocked
        setPending(null)
        if (card.target === 'enemy') {
          if (s.resolvedTargetId) s.drag.sling(card, s.resolvedTargetId) // animated arc; dispatches playCard on landing
        } else {
          // self / allAllies / allEnemies / ally / none — engine honours targetId only for 'ally'
          dispatch({ type: 'combat/playCard', iid: card.iid, targetId: e.altKey ? s.primaryPartyId : undefined })
        }
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  // Resolve the active target each render so it self-heals when the chosen foe dies/leaves, then
  // publish the live snapshot the keyboard handler reads. (Plain statements — safe before the guard.)
  const aliveEnemies = view ? view.enemies.filter((c) => c.alive) : []
  const resolvedTargetId =
    activeTargetId && aliveEnemies.some((c) => c.id === activeTargetId)
      ? activeTargetId
      : (aliveEnemies[0]?.id ?? null) // default = first living enemy
  const primaryPartyId = view?.party.find((c) => c.alive)?.id // "the player" (the lone hero today)
  kbRef.current = {
    view,
    aliveEnemies,
    resolvedTargetId,
    primaryPartyId,
    drag,
    reduced: fb.reduced,
    mp: mpMode,
    overlayOpen: !!(deckOpen || inventoryOpen || itemInteraction || pileModal || pickModal || chatOpen),
  }

  // co-op presence: broadcast the card I've selected OR hovered + the enemy I'm aiming at, so teammates
  // see it live. Click + hover are both event-driven (low-frequency). Cleared when idle / leaving combat.
  const activeCardIid = pending?.kind === 'card' ? pending.iid : undefined
  useEffect(() => {
    if (!mpMode) return
    const activity =
      activeCardIid || hoveredCardIid || (activeCardIid && resolvedTargetId)
        ? {
            cardIid: activeCardIid,
            hoverCardIid: hoveredCardIid ?? undefined,
            targetId: activeCardIid ? (resolvedTargetId ?? undefined) : undefined,
          }
        : null
    sendActivity(activity)
  }, [mpMode, activeCardIid, hoveredCardIid, resolvedTargetId])
  useEffect(() => {
    if (!mpMode) return
    return () => sendActivity(null) // clear my presence on leaving the battle
  }, [mpMode])

  // teammates' live presence → which hand card / enemy wears a peer highlight (+ their name). A peer's
  // selected card takes precedence over a merely-hovered one.
  const peerCardLabel: Record<string, string> = {}
  const peerEnemyLabel: Record<string, string> = {}
  if (mpMode) {
    for (const p of Object.values(peers)) {
      if (!p.activity) continue
      const iid = p.activity.cardIid ?? p.activity.hoverCardIid
      if (iid) peerCardLabel[iid] = p.name
      if (p.activity.targetId) peerEnemyLabel[p.activity.targetId] = p.name
    }
  }

  if (!view) return null

  // Co-op card ownership: a card acts on behalf of its OWNER. Color each card + party unit by owner so
  // it's clear whose hero a card affects; only meaningful with >1 hero (single-player has one owner).
  const showOwners = mpMode && view.party.length > 1
  const partyOrder = view.party.map((c) => c.id) // party combatant id === memberId
  // co-op: a teammate's open sharpen/cast-off pick modal to mirror read-only (first active one)
  const mirroredPick = Object.values(peerPicks)[0]
  const ownerColorOf = (memberId: string): string | undefined => (showOwners ? playerColor(memberId, partyOrder) : undefined)
  const ownerSymbolOf = (memberId: string): string | undefined => (showOwners ? playerSymbol(memberId, partyOrder) : undefined)

  const enemyTargetable = pending?.kind === 'card' || (pending?.kind === 'grace' && pending.ability === 'mercy')
  // Carrying a bag item → click a unit to open the action wheel on it (InventoryLayer routes "Use" to
  // combat/useItem). No highlight/preview — same restraint as the scene; you find out by trying.
  const carrying = itemInteraction != null
  const holding = itemInteraction?.phase === 'holding'
  const aimAtUnit = (id: string, e: { clientX: number; clientY: number }) =>
    aimItemAt({ kind: 'unit', id }, { x: e.clientX, y: e.clientY })

  // While aiming a damage card, show the EXACT hit each enemy would take (level scale + statuses +
  // rows + their block) — the honest correction over the card's nominal number.
  const pendingCard = pending?.kind === 'card' ? view.hand.find((h) => h.iid === pending.iid) : undefined
  const spirit = state.run?.spirit.spirit ?? 0
  const targetPreview = (enemyId: string): number | null => {
    if (!pendingCard || !state.combat) return null
    // a card acts as its OWNER (co-op), so preview the hit scaled off the owner — matches the real play
    const p = previewCardDamage(state.combat, pendingCard.defId, pendingCard.ownerId, spirit, enemyId)
    return p ? p.total : null
  }
  // co-op: an 'ally' card is aimed at a chosen party member → the party units become click targets
  // an 'ally' support card is being aimed — via click-select (pending) OR mid-drag (aiming) — so party
  // members become valid drop targets (glow) either way.
  const aimingCard = drag.aimingIid ? view.hand.find((h) => h.iid === drag.aimingIid) : undefined
  const activeCard = (pending?.kind === 'card' ? pendingCard : undefined) ?? (aimingCard?.target === 'ally' ? aimingCard : undefined)
  const partyTargetable = activeCard?.target === 'ally'
  // party members the active (selected OR aimed) card will affect (colored pulse): owner for self,
  // everyone for allAllies, and (as candidates) everyone for an ally card.
  const affectedPartyIds = new Set<string>()
  if (activeCard) {
    if (activeCard.target === 'self') affectedPartyIds.add(activeCard.ownerId)
    else if (activeCard.target === 'allAllies' || activeCard.target === 'ally') for (const c of view.party) if (c.alive) affectedPartyIds.add(c.id)
  }

  const clickCard = (card: HandCardView) => {
    if (itemInteraction) clearItemInteraction() // picking a card cancels any in-flight item flow
    if (card.unplayable) return // clutter (Spike): cannot be played
    // unaffordable → no-op (the card is shown greyed). The button's `disabled` doesn't reliably block
    // the drag-hook's tap path, so we gate here too — otherwise a tap could still select / open the
    // pick modal / play a card the player has no energy for.
    if (view.energy.current < card.cost) return
    if (pending?.kind === 'card' && pending.iid === card.iid) return setPending(null) // click again → cancel
    if (card.pick) {
      // hone / cast off / prepare: open the card picker; the card commits only on confirm
      setPending(null)
      setPickModal({ iid: card.iid, pick: card.pick })
      return
    }
    // enemy card → pick an enemy; ally support card → pick a party member; self/allAllies → play now
    if (card.target === 'enemy' || card.target === 'ally') setPending({ kind: 'card', iid: card.iid })
    else {
      dispatch({ type: 'combat/playCard', iid: card.iid })
      setPending(null)
    }
  }
  const clickParty = (id: string) => {
    if (pending?.kind !== 'card') return
    const card = view.hand.find((h) => h.iid === pending.iid)
    if (!card || card.target !== 'ally') return // only 'ally' support cards target a teammate
    drag.sling(card, id) // same arc-throw animation as an enemy play; resolves on landing
    setPending(null)
  }
  const clickEnemy = (id: string, isHuman: boolean) => {
    setActiveTargetId(id) // clicking/tapping an enemy makes it the active target (kept across turns)
    if (pending?.kind === 'card') {
      const card = view.hand.find((h) => h.iid === pending.iid)
      if (card) drag.sling(card, id) // same arc throw + landing-synced damage as a drag-played card
      else dispatch({ type: 'combat/playCard', iid: pending.iid, targetId: id })
      setPending(null)
    } else if (pending?.kind === 'grace' && pending.ability === 'mercy' && isHuman) {
      dispatch({ type: 'combat/useGrace', ability: 'mercy', targetId: id })
      setPending(null)
    }
  }
  const useGraceAbility = (ability: string) => {
    if (itemInteraction) clearItemInteraction()
    setPending({ kind: 'grace', ability }) // mercy → pick a human (Sight is now a card, not grace)
  }
  // unit click routing: item-aim while carrying, otherwise target an enemy with the pending card/grace
  const onUnitClick = (c: CombatantView, side: 'party' | 'enemy', e: { clientX: number; clientY: number; stopPropagation: () => void }) => {
    if (carrying) {
      e.stopPropagation()
      if (holding) aimAtUnit(c.id, e)
      return
    }
    if (side === 'enemy') clickEnemy(c.id, c.isHuman)
    else clickParty(c.id) // party unit → receive a pending 'ally' support card
  }

  // Drag-to-play: a press that moves becomes a drag (ghost follows the cursor, slings to the target on
  // release); a press that doesn't move falls back to the normal tap/select via clickCard. Disabled
  // while carrying a bag item (that interaction owns the pointer).
  drag.setHandlers({
    enabled: !carrying,
    reduced: fb.reduced,
    isPlayable: (card) => !card.unplayable && view.energy.current >= card.cost,
    playCard: (card, targetId) => dispatch({ type: 'combat/playCard', iid: card.iid, targetId }),
    onTap: clickCard,
  })

  const N = view.hand.length
  const fanOf = (i: number) => {
    const offset = i - (N - 1) / 2
    // wide, near-flat fan: cards spread out and only slightly overlap (cf. screenshots/battle-ui.jpg).
    // Step is < card width (140px) so neighbours overlap; keep in sync if the card width changes.
    return { x: offset * 122, y: Math.pow(Math.abs(offset), 1.5) * 7, rotate: offset * 4 }
  }

  // While acting, if NO card in hand can still be played (every one is unplayable or unaffordable —
  // covers both "out of energy" and "out of playable cards"), nudge the player toward End Turn.
  const endTurnReady =
    view.outcome === 'ongoing' &&
    view.phase === 'partyAction' &&
    !view.hand.some((c) => !c.unplayable && view.energy.current >= c.cost)

  // co-op: how many enemies are about to strike each party member (so everyone sees who's in danger)
  const incomingByMember: Record<string, number> = {}
  if (mpMode) {
    for (const e of view.enemies) {
      const k = e.intentKind
      if (e.alive && e.intentTargetId && (k === 'attack' || k === 'attackMulti' || k === 'debuff' || k === 'clutter')) {
        incomingByMember[e.intentTargetId] = (incomingByMember[e.intentTargetId] ?? 0) + 1
      }
    }
  }

  return (
    <div className="screen combat" style={{ backgroundImage: assetBg(view.battleBg) ?? bgUrl('004-battlefield-enchanted-forest.webp') }}>
      <div className="scrim" />
      <Hud />

      <motion.div className="battlefield" animate={shakeControls}>
        <div className="side party">
          {/* dead members stay on the field (slumped) rather than vanishing — position is a game
              element, and a fallen hero needs to be SEEN before the game-over screen */}
          {view.party.map((c) => (
            <CombatUnit key={c.id} c={c} side="party" t={t} reduced={fb.reduced} reaction={fb.reactions[c.id]} float={fb.floats[c.id]} predicted={null} targetable={partyTargetable && c.alive} dropHighlight={drag.hoveredTargetId === c.id} affectedColor={affectedPartyIds.has(c.id) ? ownerColorOf(c.id) : undefined} ownerColor={ownerColorOf(c.id)} ownerSymbol={ownerSymbolOf(c.id)} incoming={incomingByMember[c.id]} onUnitClick={onUnitClick} />
          ))}
        </div>
        <div className="side enemies">
          {view.enemies.map((c) => (
            <CombatUnit
              key={c.id}
              c={c}
              side="enemy"
              t={t}
              reduced={fb.reduced}
              reaction={fb.reactions[c.id]}
              float={fb.floats[c.id]}
              predicted={c.alive && pendingCard ? targetPreview(c.id) : null}
              targetable={enemyTargetable && c.alive}
              activeTarget={resolvedTargetId === c.id && view.outcome === 'ongoing'}
              dropHighlight={drag.hoveredTargetId === c.id}
              peerLabel={peerEnemyLabel[c.id]}
              onUnitClick={onUnitClick}
            />
          ))}
        </div>
      </motion.div>

      {/* player-death cinematic: a dark-red veil bleeds over the held battlefield (the fallen hero
          slumps in place) before the store reveals the game-over panel */}
      {view.outcome === 'defeat' && !fb.reduced && (
        <motion.div className="death-veil" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.4, ease: 'easeIn' }} />
      )}

      {/* victory cinematic: a golden light blooms over the held battlefield (felled foes slumped in
          place) before the store reveals the reward screen */}
      {(view.outcome === 'victory' || view.outcome === 'peaceful') && !fb.reduced && (
        <motion.div className="victory-veil" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, ease: 'easeOut' }} />
      )}

      <AnimatePresence>
        {banner && (
          <motion.div
            key={`${banner.kind}-${banner.seq}`}
            className={'turn-banner ' + banner.kind}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {t(banner.kind === 'party' ? 'ui.combat.yourTurn' : 'ui.combat.enemyTurn')}
          </motion.div>
        )}
      </AnimatePresence>

      {pending && <div className="targeting-hint">{t('ui.combat.pickTarget')}</div>}

      {/* corner actions, away from the figures: Flee top-left, Hold (grace) top-right */}
      {view.canFlee && (
        <button className="btn ghost small corner-action left" onClick={() => { setHandDiscarding(true); dispatch({ type: 'combat/flee' }) }}>{t('ui.combat.flee')}</button>
      )}
      <div className="corner-action right">
        {[...new Set(view.graceAbilities)].map((g) => (
          <button key={g} className="btn grace small" onClick={() => useGraceAbility(g)}>{t(`grace.${g}.name`)}</button>
        ))}
      </div>

      <div className="combat-hud">
        {/* draw pile hugs the bottom-left corner; the energy orb sits up + to its right */}
        <div className="hud-left">
          <button type="button" className="card-stack draw" onClick={() => setPileModal('draw')} title={t('ui.combat.draw')}><span className="stack-count">{view.drawCount}</span><label>{t('ui.combat.draw')}</label></button>
          <motion.div className="energy-orb" style={energyOrbStyle(view.energy.current, view.energy.max)} animate={energyControls}><b>{view.energy.current}</b><span>/{view.energy.max}</span><label>{t('ui.combat.energy')}</label></motion.div>
        </div>

        <div className="hand-fan">
          <AnimatePresence custom={{ ending: handDiscarding }}>
            {view.hand.map((card, i) => (
              <CardView
                key={card.iid}
                card={card}
                playable={!card.unplayable && view.energy.current >= card.cost}
                selected={pending?.kind === 'card' && pending.iid === card.iid}
                onPointerDown={(e) => drag.beginDrag(e, card)}
                fan={fanOf(i)}
                z={i}
                flyTo={card.target === 'enemy' || card.target === 'allEnemies' ? { x: 210, y: -280 } : undefined}
                reduced={fb.reduced}
                aiming={drag.aimingIid === card.iid && !drag.ghost}
                launched={drag.launchedIid === card.iid}
                peerLabel={peerCardLabel[card.iid]}
                ownerColor={ownerColorOf(card.ownerId)}
                ownerSymbol={ownerSymbolOf(card.ownerId)}
                onHover={mpMode ? (h) => setHoveredCardIid((cur) => (h ? card.iid : cur === card.iid ? null : cur)) : undefined}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* discard pile hugs the bottom-right corner; End Turn sits up + to its left (more reachable) */}
        <div className="hud-right">
          {/* End Turn: reduced motion resolves the enemy turn instantly (batch); otherwise hand off to
              the UI-paced stepped turn (begin → the self-clocking effect advances one enemy at a time) */}
          <button className={'btn end-turn' + (endTurnReady ? ' ready' : '')} title={`${t('ui.combat.endTurn')} (Enter / F)`} onClick={() => { setHandDiscarding(true); dispatch({ type: mpMode || fb.reduced ? 'combat/endTurn' : 'combat/beginEnemyTurn' }) }}>{t('ui.combat.endTurn')}</button>
          {/* the single right-side pile shows discarded AND exhausted cards (count + viewer combined) */}
          <button type="button" className="card-stack discard" onClick={() => setPileModal('discard')} title={t('ui.combat.discard')}><span className="stack-count">{view.discardCount + view.exhaustCount}</span><label>{t('ui.combat.discard')}</label></button>
        </div>
      </div>

      {pileModal && (
        <CardListModal
          titleKey={`ui.deck.pile.${pileModal}`}
          // the discard pile now also lists exhausted cards (the exhaust pile was merged into it)
          cards={pileModal === 'discard' ? [...selectCombatPile(state, 'discard'), ...selectCombatPile(state, 'exhaust')] : selectCombatPile(state, pileModal)}
          onClose={() => setPileModal(null)}
        />
      )}
      {pickModal && (
        <CardPickModal playedIid={pickModal.iid} pick={pickModal.pick} onClose={() => setPickModal(null)} />
      )}
      {/* co-op: mirror a teammate's open sharpen/cast-off pick (read-only) so everyone sees it. Only
          when this client isn't itself picking (its own modal takes precedence). */}
      {!pickModal && mirroredPick && (
        <CardPickModal
          playedIid={mirroredPick.pick.playedIid}
          pick={{ kind: mirroredPick.pick.kind, count: mirroredPick.pick.count }}
          mirrorSelection={mirroredPick.pick.selection}
          mirrorName={mirroredPick.name}
          readOnly
          onClose={() => {}}
        />
      )}

      {/* the targeting arrow dragged from the card to the cursor while aiming */}
      {drag.aim && <AimPointer from={drag.aim.from} x={drag.aim.x} y={drag.aim.y} valid={drag.aim.valid} />}

      {/* on release, a copy of the card slings from the hand into the target, then smashes in */}
      {drag.ghost && (
        <motion.div className="card-ghost" style={{ x: drag.ghost.x, y: drag.ghost.y, scale: drag.ghost.scale, opacity: drag.ghost.opacity, rotate: drag.ghost.rotate }}>
          <CardFace
            cost={drag.ghost.card.cost}
            layer={drag.ghost.card.layer}
            nameKey={drag.ghost.card.nameKey}
            textKey={drag.ghost.card.textKey}
            verse={drag.ghost.card.type === 'verse'}
            rarity={drag.ghost.card.rarity}
            damage={drag.ghost.card.damage}
            miracle={drag.ghost.card.miracle}
            values={drag.ghost.card.values}
          />
        </motion.div>
      )}

      {/* impact burst at the spot the slung card lands */}
      {drag.impact && (
        <motion.div
          key={drag.impact.seq}
          className="card-impact"
          style={{ left: drag.impact.x, top: drag.impact.y }}
          initial={{ scale: 0.3, opacity: 0.95 }}
          animate={{ scale: 2, opacity: 0 }}
          transition={{ duration: 0.34, ease: 'easeOut' }}
        />
      )}
    </div>
  )
}

// the figure animation for a transient reaction (skipped under reduced motion)
function reactionAnim(reaction: UnitReaction | undefined, side: 'party' | 'enemy', reduced: boolean) {
  if (!reaction || reduced) return { x: 0, scale: 1 }
  switch (reaction.kind) {
    case 'lunge':
      return { x: side === 'party' ? [0, 18, 0] : [0, -18, 0], scale: 1 }
    case 'hit':
      return { x: [0, -7, 6, -4, 0], scale: 1 }
    case 'block':
      return { x: 0, scale: [1, 0.93, 1] }
    case 'heal':
      return { x: 0, scale: [1, 1.07, 1] }
    default:
      return { x: 0, scale: 1 }
  }
}

// The combatant's figure: the registered PNG for its archetype, or the emoji placeholder when no art
// is registered/present (the 404 of a not-yet-added sprite trips onError → fallback, so dropping a PNG
// into public/assets "lights it up" with no code change). Static art; the .sprite-react wrapper +
// .sprite CSS rules animate it (lunge/hit/idle-breathe/bob/death).
function CombatSprite({ c }: { c: CombatantView }) {
  const url = spriteUrl(c)
  const [failed, setFailed] = useState(false)
  if (!url || failed) return <span className="sprite">{spriteEmoji(c)}</span>
  const scale = spriteScale(c)
  return (
    <img
      className="sprite sprite-img"
      src={url}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      style={scale !== 1 ? { height: (c.row === 'back' ? 150 : 200) * scale } : undefined}
    />
  )
}

// A combatant standing on the field: figure (with reaction + impact flash + rising numbers) + nameplate.
// Module-level so it has a stable identity across CombatScreen re-renders — its Framer animations would
// otherwise re-fire on every state change.
function CombatUnit({
  c,
  side,
  t,
  reduced,
  reaction,
  float,
  predicted,
  targetable,
  activeTarget,
  dropHighlight,
  peerLabel,
  incoming,
  affectedColor,
  ownerColor,
  ownerSymbol,
  onUnitClick,
}: {
  c: CombatantView
  side: 'party' | 'enemy'
  t: (key: string, opts?: Record<string, unknown>) => string
  reduced: boolean
  reaction?: UnitReaction
  float?: UnitFloat
  predicted: number | null
  targetable: boolean
  // the persistently-selected enemy (keyboard/click target) — wears a steady reticle
  activeTarget?: boolean
  // a card is being dragged over this enemy — glow it as a drop target
  dropHighlight?: boolean
  // co-op: a teammate is aiming at this enemy — show their name (non-authoritative)
  peerLabel?: string
  // co-op: how many enemies are about to strike this party member (shows who's in danger)
  incoming?: number
  // co-op: the selected card will affect this party member → pulse in this (owner) color
  affectedColor?: string
  // co-op: this party member's owner color (nameplate tint)
  ownerColor?: string
  // co-op: this party member's identity shape (shown before the name, in the owner color)
  ownerSymbol?: string
  onUnitClick: (c: CombatantView, side: 'party' | 'enemy', e: { clientX: number; clientY: number; stopPropagation: () => void }) => void
}) {
  const hpPct = Math.max(0, (c.hp / c.maxHp) * 100)
  const tgt = ((side === 'enemy' || side === 'party') && targetable) || !!dropHighlight
  const showFlash = reaction && !reduced && reaction.kind !== 'lunge'
  return (
    <motion.div
      layout
      data-cid={c.id}
      data-faction={c.faction}
      style={affectedColor || ownerColor ? ({ '--owner': affectedColor ?? ownerColor } as CSSProperties) : undefined}
      className={['unit', side, c.row, tgt ? 'targetable' : '', activeTarget ? 'active-target' : '', affectedColor ? 'affected' : '', ownerColor ? 'owned' : '', c.isDemon ? 'demon' : '', c.alive ? '' : c.subdued ? 'subdued' : 'dead'].join(' ')}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      onClick={(e) => onUnitClick(c, side, e)}
    >
      {/* over-head stack: name (always) + intent pill (alive enemy) / defeated marker — all ABOVE the head */}
      <div className="unit-overhead">
        {peerLabel && <div className="unit-peer-tag">👁 {peerLabel}</div>}
        {side === 'party' && c.alive && incoming ? <div className="unit-incoming" title="under attack">⚔{incoming > 1 ? `×${incoming}` : ''}</div> : null}
        {side === 'enemy' && c.alive && c.intentKind && (
          <Tip className="intent" text={intentText(c, t)}>
            {INTENT_ICON[c.intentKind] ?? '❔'}
            {c.intentKind === 'attackMulti' && c.intentValue ? (
              <b>{c.intentValue}×{c.intentHits ?? 1}</b>
            ) : c.intentValue ? (
              <b>{c.intentValue}</b>
            ) : c.intentStacks ? (
              <b>{c.intentStacks}</b>
            ) : null}
          </Tip>
        )}
        {!c.alive && <div className="unit-defeated" title={c.subdued ? 'subdued' : 'defeated'}>{c.subdued ? '💫' : '💀'}</div>}
        <div className="unit-name">
          {ownerSymbol && <span className="owner-symbol">{ownerSymbol}</span>}
          {c.displayName ?? t(c.nameKey)}
          {/* target lock-on: corner brackets that snap onto the selected enemy's NAME PLATE and hold
              (re-mounts — so the snap replays — whenever the active target changes) */}
          {activeTarget && (
            <span className="target-reticle" aria-hidden="true">
              <span className="tr-corner tl" />
              <span className="tr-corner tr" />
              <span className="tr-corner bl" />
              <span className="tr-corner br" />
            </span>
          )}
        </div>
      </div>
      <div className="unit-figure">
        {predicted !== null && <div className="dmg-predict">−{predicted}</div>}
        <motion.div className="sprite-react" key={reaction?.seq ?? 'idle'} animate={reactionAnim(reaction, side, reduced)} transition={{ duration: 0.34 }}>
          <CombatSprite c={c} />
          {showFlash && <motion.div className={'hit-flash ' + reaction!.kind} initial={{ opacity: 0.8 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }} />}
        </motion.div>
        {/* impact burst when a party member is struck — gives an enemy hit the same punch as the
            player's slingshot landing (enemy hits already get drag.impact at the landing spot) */}
        {side === 'party' && reaction?.kind === 'hit' && !reduced && (
          <motion.div key={'impact-' + reaction.seq} className="unit-impact" initial={{ scale: 0.3, opacity: 0.95 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 0.38, ease: 'easeOut' }} />
        )}
        <span className="unit-shadow" />
        <AnimatePresence>
          {float && (
            <motion.div key={float.seq} className={float.tone === 'dmg' ? 'dmg-float' : 'heal-float'} initial={{ y: 0, opacity: 1 }} animate={{ y: -46, opacity: 0 }} transition={{ duration: 0.9 }}>
              {float.tone === 'dmg' ? '-' : '+'}{float.amount}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="unit-plate">
        <div className="hp-bar">
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">{c.hp}/{c.maxHp}</span>
        </div>
        <div className="badges">
          {c.block > 0 && <Tip className="badge block" text={t('ui.combat.blockHint')}>🛡 {c.block}</Tip>}
          {c.shield && (
            <Tip className="badge ward" text={t('ui.combat.wardHint')}>
              🛡✨ {Math.round(c.shield.chance * 100)}% · {c.shield.turns}t
            </Tip>
          )}
          {c.lastStand && <Tip className="badge laststand" text={t('ui.combat.lastStandHint')}>🔥 {t('ui.combat.lastStand')}</Tip>}
          {c.row === 'back' && <Tip className="badge row" text={t('ui.combat.backRowHint')}>{t('ui.combat.backRow')}</Tip>}
          {c.statuses.map((s) => (
            <Tip key={s.id} className={'badge status ' + (STATUS_KIND[s.id] ?? 'debuff')} text={<><b>{t(`status.${s.id}.name`)}</b> — {t(`status.${s.id}.desc`)}</>}>
              {STATUS_ICON[s.id] ?? '◆'} {s.stacks}
            </Tip>
          ))}
          {c.powers.map((p) => (
            <Tip key={p.id} className="badge power" text={<><b>{t(`power.${p.id}.name`)}</b> — {t(`power.${p.id}.desc`)}</>}>
              {POWER_ICON[p.id] ?? '✦'}{p.stacks > 1 ? ` ${p.stacks}` : ''}
            </Tip>
          ))}
        </div>
      </div>
    </motion.div>
  )
}
