import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { previewCardDamage } from '@bible/engine'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'
import { selectCombat, selectCombatPile, type CombatantView, type HandCardView } from '../selectors'
import { CardView } from '../components/Card'
import { Hud } from '../components/Hud'
import { CardListModal } from '../components/CardListModal'
import { CardPickModal, type PickSpec } from '../components/CardPickModal'
import { useCombatFeedback, type UnitFloat, type UnitReaction } from './useCombatFeedback'

const INTENT_ICON: Record<string, string> = { attack: '⚔️', attackMulti: '⚔️', dread: '🌑', block: '🛡️', buff: '⬆️', debuff: '⬇️', clutter: '🌫️', special: '…', unknown: '❔' }

export function CombatScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectCombat(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const itemInteraction = useGame((s) => s.itemInteraction)
  const aimItemAt = useGame((s) => s.aimItemAt)
  const clearItemInteraction = useGame((s) => s.clearItemInteraction)
  const fb = useCombatFeedback()
  const [pending, setPending] = useState<{ kind: 'card'; iid: string } | { kind: 'grace'; ability: string } | null>(null)
  // a bottom-corner pile to inspect (read-only), and a "pick cards" prompt for hone/cast-off/prepare
  const [pileModal, setPileModal] = useState<'draw' | 'discard' | 'exhaust' | null>(null)
  const [pickModal, setPickModal] = useState<{ iid: string; pick: PickSpec } | null>(null)
  // a transient "Your Turn / Enemy Turn" banner, raised by the feedback hook's turn cue
  const [banner, setBanner] = useState<{ kind: 'party' | 'enemy'; seq: number } | null>(null)

  // Screen shake (battlefield only — never the clickable hand) and the energy-orb spend pulse.
  const shakeControls = useAnimationControls()
  const energyControls = useAnimationControls()

  // Auto-begin the action phase each round: the engine opens combat (and every new round) in a brief
  // "decision" window before the hand is drawn — draw it automatically so the player never presses ▶.
  useEffect(() => {
    if (view?.phase === 'partyDecision' && view.outcome === 'ongoing') dispatch({ type: 'combat/beginAction' })
  }, [view?.phase, view?.outcome, dispatch])

  useEffect(() => {
    if (fb.shake && !fb.reduced) void shakeControls.start({ x: [0, -6, 6, -4, 0], transition: { duration: 0.26 } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb.shake])
  useEffect(() => {
    if (fb.energyPulse && !fb.reduced) void energyControls.start({ scale: [1, 1.16, 1], transition: { duration: 0.3 } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb.energyPulse])
  useEffect(() => {
    if (!fb.turnCue) return
    setBanner(fb.turnCue)
    const id = setTimeout(() => setBanner(null), 950)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fb.turnCue?.seq])

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
      dispatch({ type: 'combat/playCard', iid: pending.iid, targetId: id })
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

  const N = view.hand.length
  const fanOf = (i: number) => {
    const offset = i - (N - 1) / 2
    // wide, near-flat fan: cards spread out and only slightly overlap (cf. screenshots/battle-ui.jpg)
    return { x: offset * 100, y: Math.pow(Math.abs(offset), 1.5) * 5, rotate: offset * 4 }
  }

  return (
    <div className="screen combat" style={{ backgroundImage: assetBg(view.battleBg) ?? bgUrl('004-battlefield-enchanted-forest.png') }}>
      <div className="scrim" />
      <Hud />

      <motion.div className="battlefield" animate={shakeControls}>
        <div className="side party">
          {view.party.filter((c) => c.alive).map((c) => (
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
              onUnitClick={onUnitClick}
            />
          ))}
        </div>
      </motion.div>

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

      <div className="combat-hud">
        <div className="hud-left">
          <motion.div className="energy-orb" animate={energyControls}><b>{view.energy.current}</b><span>/{view.energy.max}</span><label>{t('ui.combat.energy')}</label></motion.div>
          <button type="button" className="card-stack draw" onClick={() => setPileModal('draw')} title={t('ui.combat.draw')}><span className="stack-count">{view.drawCount}</span><label>{t('ui.combat.draw')}</label></button>
        </div>

        <div className="hand-fan">
          <AnimatePresence>
            {view.hand.map((card, i) => (
              <CardView
                key={card.iid}
                card={card}
                playable={!card.unplayable && view.energy.current >= card.cost}
                selected={pending?.kind === 'card' && pending.iid === card.iid}
                onClick={() => clickCard(card)}
                fan={fanOf(i)}
                z={i}
                flyTo={card.target === 'enemy' || card.target === 'allEnemies' ? { x: 210, y: -280 } : undefined}
                reduced={fb.reduced}
              />
            ))}
          </AnimatePresence>
        </div>

        <div className="hud-right">
          <div className="grace-row">
            {[...new Set(view.graceAbilities)].map((g) => (
              <button key={g} className="btn grace small" onClick={() => useGraceAbility(g)}>{t(`grace.${g}.name`)}</button>
            ))}
          </div>
          <div className="hud-right-row">
            {view.canFlee && <button className="btn ghost small" onClick={() => dispatch({ type: 'combat/flee' })}>{t('ui.combat.flee')}</button>}
            <button className="btn end-turn" onClick={() => dispatch({ type: 'combat/endTurn' })}>{t('ui.combat.endTurn')}</button>
          </div>
          <div className="pile-row">
            <button type="button" className="card-stack discard" onClick={() => setPileModal('discard')} title={t('ui.combat.discard')}><span className="stack-count">{view.discardCount}</span><label>{t('ui.combat.discard')}</label></button>
            <button type="button" className="card-stack exhaust" onClick={() => setPileModal('exhaust')} title={t('ui.combat.exhaust')}><span className="stack-count">{view.exhaustCount}</span><label>{t('ui.combat.exhaust')}</label></button>
          </div>
        </div>
      </div>

      {pileModal && (
        <CardListModal
          titleKey={`ui.deck.pile.${pileModal}`}
          cards={selectCombatPile(state, pileModal)}
          onClose={() => setPileModal(null)}
        />
      )}
      {pickModal && (
        <CardPickModal playedIid={pickModal.iid} pick={pickModal.pick} onClose={() => setPickModal(null)} />
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
  onUnitClick: (c: CombatantView, side: 'party' | 'enemy', e: { clientX: number; clientY: number; stopPropagation: () => void }) => void
}) {
  const hpPct = Math.max(0, (c.hp / c.maxHp) * 100)
  const tgt = side === 'enemy' && targetable
  const showFlash = reaction && !reduced && reaction.kind !== 'lunge'
  return (
    <motion.div
      layout
      className={['unit', side, c.row, tgt ? 'targetable' : '', c.isDemon ? 'demon' : '', c.alive ? '' : 'dead'].join(' ')}
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
      <div className="unit-figure">
        {predicted !== null && <div className="dmg-predict">−{predicted}</div>}
        <motion.div className="sprite-react" key={reaction?.seq ?? 'idle'} animate={reactionAnim(reaction, side, reduced)} transition={{ duration: 0.34 }}>
          <span className="sprite">{spriteGlyph(c)}</span>
          {showFlash && <motion.div className={'hit-flash ' + reaction!.kind} initial={{ opacity: 0.8 }} animate={{ opacity: 0 }} transition={{ duration: 0.45 }} />}
        </motion.div>
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
