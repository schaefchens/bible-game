import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { previewCardDamage } from '@bible/engine'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'
import { selectCombat, type CombatantView } from '../selectors'
import { CardView } from '../components/Card'
import { Hud } from '../components/Hud'

const INTENT_ICON: Record<string, string> = { attack: '⚔️', attackMulti: '⚔️', dread: '🌑', block: '🛡️', buff: '⬆️', debuff: '⬇️', special: '…', unknown: '❔' }

export function CombatScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectCombat(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const lastEvents = useGame((s) => s.lastEvents)
  const tick = useGame((s) => s.tick)
  const [pending, setPending] = useState<{ kind: 'card'; iid: string } | { kind: 'grace'; ability: string } | null>(null)

  // Auto-begin the action phase each round: the engine opens combat (and every new round) in a brief
  // "decision" window before the hand is drawn — draw it automatically so the player never presses ▶.
  useEffect(() => {
    if (view?.phase === 'partyDecision' && view.outcome === 'ongoing') dispatch({ type: 'combat/beginAction' })
  }, [view?.phase, view?.outcome, dispatch])

  // transient damage flashes keyed by the dispatch tick
  const dmgByTarget = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of lastEvents) if (e.type === 'damageDealt' && e.amount > 0) m[e.targetId] = (m[e.targetId] ?? 0) + e.amount
    return m
  }, [lastEvents, tick])

  if (!view) return null

  const enemyTargetable = pending?.kind === 'card' || (pending?.kind === 'grace' && pending.ability === 'mercy')

  // While aiming a damage card, show the EXACT hit each enemy would take (level scale + statuses +
  // rows + their block) — the honest correction over the card's nominal number.
  const pendingCard = pending?.kind === 'card' ? view.hand.find((h) => h.iid === pending.iid) : undefined
  const spirit = state.run?.spirit.spirit ?? 0
  const targetPreview = (enemyId: string): number | null => {
    if (!pendingCard || !state.combat) return null
    const p = previewCardDamage(state.combat, pendingCard.defId, pendingCard.ownerId, spirit, enemyId)
    return p ? p.total : null
  }

  const clickCard = (iid: string, target: string) => {
    if (pending?.kind === 'card' && pending.iid === iid) return setPending(null) // click again → cancel
    if (target === 'enemy') setPending({ kind: 'card', iid })
    else {
      dispatch({ type: 'combat/playCard', iid })
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
    if (ability === 'sight') dispatch({ type: 'combat/useGrace', ability: 'sight' })
    else setPending({ kind: 'grace', ability }) // mercy → pick a human
  }

  const N = view.hand.length
  const fanOf = (i: number) => {
    const offset = i - (N - 1) / 2
    return { x: offset * 52, y: Math.pow(Math.abs(offset), 1.5) * 6, rotate: offset * 5 }
  }

  const Unit = ({ c, side }: { c: CombatantView; side: 'party' | 'enemy' }) => {
    const hpPct = Math.max(0, (c.hp / c.maxHp) * 100)
    const targetable = side === 'enemy' && enemyTargetable
    const predicted = side === 'enemy' && pendingCard ? targetPreview(c.id) : null
    return (
      <motion.div
        layout
        className={['unit', side, c.row, targetable ? 'targetable' : '', c.isDemon ? 'demon' : ''].join(' ')}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        onClick={() => side === 'enemy' && clickEnemy(c.id, c.isHuman)}
      >
        {side === 'enemy' && c.intentKind && (
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
          {predicted !== null && (
            <div className="dmg-predict">−{predicted}</div>
          )}
          <span className="sprite">{spriteGlyph(c)}</span>
          <span className="unit-shadow" />
          <AnimatePresence>
            {dmgByTarget[c.id] ? (
              <motion.div key={tick + c.id} className="dmg-float" initial={{ y: 0, opacity: 1 }} animate={{ y: -46, opacity: 0 }} transition={{ duration: 0.9 }}>
                -{dmgByTarget[c.id]}
              </motion.div>
            ) : null}
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
            {c.ward > 0 && <span className="badge ward">✨ {c.ward}</span>}
            {c.row === 'back' && <span className="badge row">{t('ui.combat.backRow')}</span>}
          </div>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="screen combat" style={{ backgroundImage: assetBg(view.battleBg) ?? bgUrl('004-battlefield-enchanted-forest.png') }}>
      <div className="scrim" />
      <Hud />

      <div className="battlefield">
        <div className="side party">{view.party.filter((c) => c.alive).map((c) => <Unit key={c.id} c={c} side="party" />)}</div>
        <div className="side enemies">{view.enemies.map((c) => <Unit key={c.id} c={c} side="enemy" />)}</div>
      </div>

      {pending && <div className="targeting-hint">{t('ui.combat.pickTarget')}</div>}

      <div className="combat-hud">
        <div className="hud-left">
          <div className="energy-orb"><b>{view.energy.current}</b><span>/{view.energy.max}</span></div>
          <div className="card-stack draw"><span className="stack-count">{view.drawCount}</span><label>{t('ui.combat.draw')}</label></div>
        </div>

        <div className="hand-fan">
          <AnimatePresence>
            {view.hand.map((card, i) => (
              <CardView
                key={card.iid}
                card={card}
                playable={view.energy.current >= card.cost}
                selected={pending?.kind === 'card' && pending.iid === card.iid}
                onClick={() => clickCard(card.iid, card.target)}
                fan={fanOf(i)}
                z={i}
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
          <div className="card-stack discard"><span className="stack-count">{view.discardCount}</span><label>{t('ui.combat.discard')}</label></div>
        </div>
      </div>
    </div>
  )
}

function spriteGlyph(c: CombatantView): string {
  if (c.faction === 'party') return '🧍'
  if (c.isDemon) return '👹'
  if (c.isHuman) return '🥷'
  return '🐺'
}
