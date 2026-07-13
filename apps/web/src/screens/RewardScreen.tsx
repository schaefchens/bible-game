import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { myMemberId, useSession } from '../store/useSession'
import { selectReward, xpProgress } from '../selectors'
import { sfxManager } from '../audio/sfxManager'
import { CardFace } from '../components/CardFace'
import { XpBar } from '../components/XpBar'

/** FF-style XP payout: the gained amount counts DOWN while the bar fills RIGHT (and the level ticks up when
 *  a boundary is crossed). XP isn't committed until leaveReward, so we animate from the pre-fight total. */
function RewardXpBar({ startTotal, gained }: { startTotal: number; gained: number }) {
  const { t } = useTranslation()
  const reduced = useGame((s) => s.state.profile.settings.reducedMotion)
  const [shown, setShown] = useState(startTotal)
  const raf = useRef(0)
  const dinged = useRef(false)
  // at max level XP is meaningless — no gain to count, the bar just sits full (MAX).
  const atMax = xpProgress(startTotal).atMax
  const effGained = atMax ? 0 : gained

  useEffect(() => {
    const end = startTotal + effGained
    if (effGained <= 0 || reduced) { setShown(end); return }
    // "heavy train": a trapezoid velocity profile — ramp up from 0 over the first `A`, hold a steady pace
    // through the middle, then a SHORTER ramp-down over the final `B` to glide to a halt. Slow + deliberate.
    const A = 0.35 // longer acceleration
    const B = 0.15 // shorter deceleration
    const vmax = 1 / (1 - (A + B) / 2)
    const cruise = (vmax * A) / 2 + vmax * (1 - B - A) // distance covered by the end of the steady phase
    const ease = (p: number) => {
      if (p < A) return (vmax / (2 * A)) * p * p // accelerate
      if (p < 1 - B) return (vmax * A) / 2 + vmax * (p - A) // steady
      const q = p - (1 - B)
      return cruise + vmax * q - (vmax / (2 * B)) * q * q // decelerate to a stop
    }
    const dur = Math.min(6000, 2000 + effGained * 6) // much slower; scales with the payout, capped
    let t0 = 0
    const tick = (ts: number) => {
      if (!t0) t0 = ts
      const p = Math.min(1, (ts - t0) / dur)
      setShown(startTotal + effGained * ease(p))
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [startTotal, effGained, reduced])

  const prog = xpProgress(shown)
  const remaining = Math.max(0, Math.round(startTotal + effGained - shown))
  // once the ANIMATED bar has climbed past the starting level, a small note appears — in sync with the fill
  const leveledNow = prog.level > xpProgress(startTotal).level
  // ding the moment the bar ticks over (once); gated/scaled by the audio settings inside sfxManager
  useEffect(() => {
    if (leveledNow && !dinged.current) {
      dinged.current = true
      sfxManager.play('sfx/levelup')
    }
  }, [leveledNow])
  return (
    <div className="reward-xp">
      <div className="reward-xp-head">
        <span>
          {t('ui.character.level')} {prog.level}
          {leveledNow && <span className="reward-xp-up"> ⬆ {t('ui.reward.levelUpShort')}</span>}
        </span>
        {atMax ? (
          <span className="reward-xp-gain">{t('ui.character.max')}</span>
        ) : (
          remaining > 0 && <span className="reward-xp-gain">{t('ui.character.xpGained', { n: remaining })}</span>
        )}
      </div>
      <XpBar pct={prog.pct} instant />
    </div>
  )
}

export function RewardScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const mpMode = useGame((s) => s.mpMode)
  const myMember = useSession(myMemberId)
  // co-op: show THIS seat's own card options + resolution (each player picks into their own deck)
  const view = useMemo(() => selectReward(state, myMember ?? undefined), [state, myMember])
  const dispatch = useGame((s) => s.dispatch)
  const setPendingCharacterOpen = useGame((s) => s.setPendingCharacterOpen)
  const [stage, setStage] = useState<'spoils' | 'cards'>('spoils')
  // decode the level-up ding up front so it fires exactly when the bar ticks over (no first-use delay)
  useEffect(() => void sfxManager.preload(['sfx/levelup']), [])

  // XP payout for the animated bar: the seat's pre-fight total + the amount gained this fight (XP is only
  // committed on leaveReward, so the Character still holds the pre-grant total here).
  const seatId = myMember ?? state.run?.heroMemberId
  const seat = state.run?.party.find((m) => m.memberId === seatId)
  const startTotal = state.profile.slots.find((s) => s.id === seat?.characterId)?.character.xp ?? 0
  const gained = (seat && state.combat?.reward?.xpByMember[seat.memberId]) ?? 0
  // this payout crosses a level boundary → new skill points to spend (committed once we leave to the map)
  const newLevel = xpProgress(startTotal + gained).level
  const leveledUp = newLevel > xpProgress(startTotal).level

  if (!view) return null

  // Two stages: claim gold/items first, then pick a card. With no spoils, jump straight to the cards.
  const showSpoils = stage === 'spoils' && view.spoils.length > 0
  const canPickCard = !view.deckFull && view.cardOptions.length > 0 && !view.cardResolved

  // Single-player: taking a card (or declining) resolves the reward and returns to the map in one motion.
  // Co-op: each player takes/declines their OWN card, then presses Continue — the server only leaves the
  // reward once EVERY connected player has confirmed (so no one's pick is forfeited by a teammate).
  // when this fight leveled the hero up, arm the character screen to open once we're back on the map
  // (where the new points are actually available) — whichever way the reward is resolved.
  const armAllocate = () => { if (leveledUp) setPendingCharacterOpen(true) }
  const takeCard = (defId: string) => {
    dispatch({ type: 'combat/takeCard', defId })
    if (!mpMode) { armAllocate(); dispatch({ type: 'combat/leaveReward' }) }
  }
  const skip = () => { if (!mpMode) armAllocate(); dispatch({ type: mpMode ? 'combat/skipCard' : 'combat/leaveReward' }) }
  const leave = () => { armAllocate(); dispatch({ type: 'combat/leaveReward' }) }

  return (
    <div className="screen reward centered" style={{ backgroundImage: assetBg(view.rewardBg) }}>
      <div className="vignette" />
      <div className="panel narrow">
        <RewardXpBar startTotal={startTotal} gained={gained} />
        {showSpoils ? (
          <>
            <h2>{t('ui.reward.title')}</h2>
            {view.righteous && <p className="righteous">{t('ui.reward.righteous')}</p>}
            <p className="muted">{t('ui.reward.spoilsSubtitle')}</p>
            <div className="choices">
              {view.spoils.map((s) => (
                <button
                  key={s.id}
                  className="btn block reward-option"
                  disabled={s.claimed}
                  onClick={() => dispatch({ type: 'combat/claimSpoil', spoilId: s.id })}
                >
                  {s.claimed ? '✓ ' : ''}
                  {s.kind === 'money' ? t('ui.reward.money', { amount: s.label }) : t(s.label)}
                </button>
              ))}
            </div>
            <button className="btn primary block" onClick={() => setStage('cards')}>
              {t('ui.reward.continue')}
            </button>
          </>
        ) : (
          <>
            <h2>{t('ui.reward.cardTitle')}</h2>
            {canPickCard ? (
              <>
                <div className="card-row">
                  {view.cardOptions.map((c) => (
                    <CardFace
                      key={c.defId}
                      cost={c.cost}
                      layer={c.layer}
                      nameKey={c.nameKey}
                      textKey={c.textKey}
                      values={c.values}
                      verse={c.verse}
                      rarity={c.rarity}
                      onClick={() => takeCard(c.defId)}
                    />
                  ))}
                </div>
                <button className="btn block" onClick={skip}>
                  {t('ui.reward.skipCard')}
                </button>
              </>
            ) : (
              <>
                <p className="muted">
                  {view.deckFull
                    ? t('ui.reward.deckFull')
                    : mpMode && view.cardResolved
                      ? 'Waiting for your party…'
                      : view.cardOptions.length === 0
                        ? t('ui.reward.noCards')
                        : ''}
                </p>
                <button className={'btn primary block' + (leveledUp ? ' reward-allocate' : '')} onClick={leave}>
                  {leveledUp ? t('ui.reward.allocate') : mpMode ? 'Continue' : t('ui.reward.leave')}
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
