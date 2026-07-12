import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { allocMult, HERO_HP_CAP, type StatId } from '@bible/engine'
import { selectHeroStatus } from '../selectors'
import { useGame } from '../store/gameStore'
import { myMemberId, useSession } from '../store/useSession'
import { XpBar } from './XpBar'

// The player status screen (C key / HUD button). Shows the LOCAL hero's level + XP progress, core stats,
// and the three allocatable specs (HP / Damage / Defense) — each point is a small +1% bonus. When level-
// ups have banked points, a + button per spec spends one (the only place points are spent).
export function CharacterModal() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const dispatch = useGame((s) => s.dispatch)
  const setCharacterOpen = useGame((s) => s.setCharacterOpen)
  const myMember = useSession(myMemberId) // co-op: this client's own seat (null in single-player → hero)
  const status = useMemo(() => selectHeroStatus(state, myMember ?? undefined), [state, myMember])
  const close = () => setCharacterOpen(false)
  if (!status) return null

  const canSpend = status.unspentPoints > 0
  const allocate = (stat: StatId) => dispatch({ type: 'allocateStat', memberId: status.memberId, stat })
  // diminishing returns → the bonus % is derived from the point count (not equal to it)
  const bonusPct = (points: number) => Math.round((allocMult(points) - 1) * 100)
  const hpCapped = status.maxHp >= HERO_HP_CAP // extra HP points would be wasted past the hard cap
  const specs: { stat: StatId; icon: string; label: string; detail?: string; capped?: boolean }[] = [
    { stat: 'hp', icon: '❤️', label: t('ui.character.hp'), detail: `${status.hp} / ${status.maxHp}`, capped: hpCapped },
    { stat: 'dmg', icon: '⚔️', label: t('ui.character.dmg') },
    { stat: 'defend', icon: '🛡️', label: t('ui.character.defend') },
  ]

  return (
    <div className="modal-overlay" onClick={close}>
      <motion.div
        className="panel narrow char-modal"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="deck-modal-head">
          <h3>🧍 {status.name} <span className="muted">· {t('ui.character.level')} {status.level}</span></h3>
          <button className="hud-icon-btn" onClick={close} aria-label={t('ui.common.close')}>✕</button>
        </div>

        {/* XP progress */}
        <div className="char-xp">
          <div className="char-xp-head">
            <span>{t('ui.character.xp')}</span>
            <span className="muted">{status.xpToNext === null ? t('ui.character.max') : `${status.xpIntoLevel} / ${status.xpToNext}`}</span>
          </div>
          <XpBar pct={status.xpPct} />
        </div>

        {canSpend && <p className="char-points">{t('ui.character.points', { n: status.unspentPoints })}</p>}

        {/* the three allocatable specs — each point = +1% */}
        <div className="char-alloc">
          {specs.map(({ stat, icon, label, detail, capped }) => (
            <div className="char-alloc-row" key={stat}>
              <span className="char-alloc-label">{icon} {label}</span>
              {detail && <span className="muted char-alloc-detail">{detail}</span>}
              <span className="char-alloc-bonus">{capped ? t('ui.character.max') : `+${bonusPct(status.allocated[stat])}%`}</span>
              {canSpend && !capped && (
                <button className="btn tiny char-plus" onClick={() => allocate(stat)} title={t('ui.character.spend')} aria-label={t('ui.character.spend')}>+</button>
              )}
            </div>
          ))}
        </div>

        {/* read-only vitals */}
        <div className="char-stats">
          <div className="char-stat"><span className="char-stat-label">⚡ {t('ui.character.speed')}</span><span className="char-stat-val">{status.speed}</span></div>
          <div className="char-stat"><span className="char-stat-label">🪙 {t('ui.character.gold')}</span><span className="char-stat-val">{status.gold}</span></div>
          <div className="char-stat"><span className="char-stat-label">📚 {t('ui.character.deck')}</span><span className="char-stat-val">{status.deckSize} / {status.deckLimit}</span></div>
          <div className="char-stat"><span className="char-stat-label">✝️ {t('ui.character.verses')}</span><span className="char-stat-val">{status.verseCount}</span></div>
          <div className="char-stat"><span className="char-stat-label">🙏 {t('ui.character.grace')}</span><span className="char-stat-val">{status.graceAbilityIds.length}</span></div>
        </div>
      </motion.div>
    </div>
  )
}
