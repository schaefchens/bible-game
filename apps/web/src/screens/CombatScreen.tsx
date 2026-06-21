import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { previewCardDamage } from '@bible/engine'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'
import { selectCombat, selectCombatPile, type CombatantView, type HandCardView } from '../selectors'
import { CardView } from '../components/Card'
import { CardFace } from '../components/CardFace'
import { AimPointer } from '../components/AimPointer'
import { Hud } from '../components/Hud'
import { CardListModal } from '../components/CardListModal'
import { CardPickModal, type PickSpec } from '../components/CardPickModal'
import { useCombatFeedback, type UnitFloat, type UnitReaction } from './useCombatFeedback'
import { useCardDrag } from './useCardDrag'

const INTENT_ICON: Record<string, string> = { attack: '⚔️', attackMulti: '⚔️', dread: '🌑', block: '🛡️', buff: '⬆️', debuff: '⬇️', clutter: '🌫️', special: '…', unknown: '❔' }

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

export function CombatScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectCombat(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const aimItemAt = useGame((s) => s.aimItemAt)
  const clearItemInteraction = useGame((s) => s.clearItemInteraction)
  const fb = useCombatFeedback()
  const drag = useCardDrag()
  const [pending, setPending] = useState<{ kind: 'card'; iid: string } | { kind: 'grace'; ability: string } | null>(null)
  // a bottom-corner pile to inspect (read-only), and a "pick cards" prompt for hone/cast-off/prepare
  const [pileModal, setPileModal] = useState<'draw' | 'discard' | 'exhaust' | null>(null)
  const [pickModal, setPickModal] = useState<{ iid: string; pick: PickSpec } | null>(null)
  // a transient "Your Turn / Enemy Turn" banner, raised by the feedback hook's turn cue
  const [banner, setBanner] = useState<{ kind: 'party' | 'enemy'; seq: number } | null>(null)
  // true while the hand is being discarded at end-turn: the cards slide DOWN off the bottom edge
  // (vs. a single play, which keeps its fly-to-target / fly-up motion). Read by the hand's exit via
  // AnimatePresence `custom`; reset once the player is acting again with a fresh hand.
  const [handDiscarding, setHandDiscarding] = useState(false)

  // Screen shake (battlefield only — never the clickable hand) and the energy-orb spend pulse.
  const shakeControls = useAnimationControls()
  const energyControls = useAnimationControls()

  // Auto-begin the action phase each round: the engine opens combat (and every new round) in a brief
  // "decision" window before the hand is drawn — draw it automatically so the player never presses ▶.
  useEffect(() => {
    if (view?.phase === 'partyDecision' && view.outcome === 'ongoing') dispatch({ type: 'combat/beginAction' })
  }, [view?.phase, view?.outcome, dispatch])

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
    if (!enemyPhaseActive) return
    const id = setTimeout(() => dispatch({ type: 'combat/advanceEnemyTurn' }), ENEMY_STEP_GAP)
    return () => clearTimeout(id)
  }, [enemyPhaseActive, enemyStepIndex, dispatch])

  if (!view) return null

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
    const p = previewCardDamage(state.combat, pendingCard.defId, pendingCard.ownerId, spirit, enemyId)
    return p ? p.total : null
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
    if (card.target === 'enemy') setPending({ kind: 'card', iid: card.iid })
    else {
      dispatch({ type: 'combat/playCard', iid: card.iid })
      setPending(null)
    }
  }
  const clickEnemy = (id: string, isHuman: boolean) => {
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
    // wide, near-flat fan: cards spread out and only slightly overlap (cf. screenshots/battle-ui.jpg)
    return { x: offset * 140, y: Math.pow(Math.abs(offset), 1.5) * 7, rotate: offset * 4 }
  }

  // While acting, if NO card in hand can still be played (every one is unplayable or unaffordable —
  // covers both "out of energy" and "out of playable cards"), nudge the player toward End Turn.
  const endTurnReady =
    view.outcome === 'ongoing' &&
    view.phase === 'partyAction' &&
    !view.hand.some((c) => !c.unplayable && view.energy.current >= c.cost)

  return (
    <div className="screen combat" style={{ backgroundImage: assetBg(view.battleBg) ?? bgUrl('004-battlefield-enchanted-forest.png') }}>
      <div className="scrim" />
      <Hud />

      <motion.div className="battlefield" animate={shakeControls}>
        <div className="side party">
          {/* dead members stay on the field (slumped) rather than vanishing — position is a game
              element, and a fallen hero needs to be SEEN before the game-over screen */}
          {view.party.map((c) => (
            <CombatUnit key={c.id} c={c} side="party" t={t} reduced={fb.reduced} reaction={fb.reactions[c.id]} float={fb.floats[c.id]} predicted={null} targetable={false} onUnitClick={onUnitClick} />
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
              dropHighlight={drag.hoveredEnemyId === c.id}
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
              />
            ))}
          </AnimatePresence>
        </div>

        {/* discard pile hugs the bottom-right corner; End Turn sits up + to its left (more reachable) */}
        <div className="hud-right">
          {/* End Turn: reduced motion resolves the enemy turn instantly (batch); otherwise hand off to
              the UI-paced stepped turn (begin → the self-clocking effect advances one enemy at a time) */}
          <button className={'btn end-turn' + (endTurnReady ? ' ready' : '')} onClick={() => { setHandDiscarding(true); dispatch({ type: fb.reduced ? 'combat/endTurn' : 'combat/beginEnemyTurn' }) }}>{t('ui.combat.endTurn')}</button>
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
  dropHighlight,
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
  // a card is being dragged over this enemy — glow it as a drop target
  dropHighlight?: boolean
  onUnitClick: (c: CombatantView, side: 'party' | 'enemy', e: { clientX: number; clientY: number; stopPropagation: () => void }) => void
}) {
  const hpPct = Math.max(0, (c.hp / c.maxHp) * 100)
  const tgt = (side === 'enemy' && targetable) || !!dropHighlight
  const showFlash = reaction && !reduced && reaction.kind !== 'lunge'
  return (
    <motion.div
      layout
      data-cid={c.id}
      data-faction={c.faction}
      className={['unit', side, c.row, tgt ? 'targetable' : '', c.isDemon ? 'demon' : '', c.alive ? '' : c.subdued ? 'subdued' : 'dead'].join(' ')}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      onClick={(e) => onUnitClick(c, side, e)}
    >
      {side === 'enemy' && c.alive && c.intentKind && (
        <div className="intent">
          {INTENT_ICON[c.intentKind] ?? '❔'}
          {c.intentKind === 'attackMulti' && c.intentValue ? (
            <b>{c.intentValue}×{c.intentHits ?? 1}</b>
          ) : c.intentValue ? (
            <b>{c.intentValue}</b>
          ) : c.intentStacks ? (
            <b>{c.intentStacks}</b>
          ) : null}
        </div>
      )}
      {!c.alive && <div className="unit-defeated" title={c.subdued ? 'subdued' : 'defeated'}>{c.subdued ? '💫' : '💀'}</div>}
      <div className="unit-figure">
        {predicted !== null && <div className="dmg-predict">−{predicted}</div>}
        <motion.div className="sprite-react" key={reaction?.seq ?? 'idle'} animate={reactionAnim(reaction, side, reduced)} transition={{ duration: 0.34 }}>
          <span className="sprite">{spriteGlyph(c)}</span>
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
        <div className="unit-name">{c.displayName ?? t(c.nameKey)}</div>
        <div className="hp-bar">
          <div className="hp-fill" style={{ width: `${hpPct}%` }} />
          <span className="hp-text">{c.hp}/{c.maxHp}</span>
        </div>
        <div className="badges">
          {c.block > 0 && <span className="badge block">🛡 {c.block}</span>}
          {c.shield && <span className="badge ward">🛡✨ {Math.round(c.shield.chance * 100)}% · {c.shield.turns}t</span>}
          {c.lastStand && <span className="badge laststand" title={t('ui.combat.lastStandHint')}>🔥 {t('ui.combat.lastStand')}</span>}
          {c.row === 'back' && <span className="badge row">{t('ui.combat.backRow')}</span>}
        </div>
      </div>
    </motion.div>
  )
}

function spriteGlyph(c: CombatantView): string {
  if (c.faction === 'party') return '🧍'
  if (c.isDemon) return '👹'
  if (c.isHuman) return '🥷'
  return '🐺'
}
