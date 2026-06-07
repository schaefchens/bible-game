import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'

// The fire: created pilgrims sit in a ring around a campfire (Diablo-II-style character select,
// Bible-flavoured). Pick a pilgrim, then choose the adventure. An empty seat adds a new pilgrim.
// A hero with an in-progress run can resume it; otherwise "Begin" starts a fresh journey.
export function HeroSelectScreen() {
  const { t } = useTranslation()
  const slots = useGame((s) => s.state.profile.slots)
  const resumableIds = useGame((s) => s.resumableIds)
  const dispatch = useGame((s) => s.dispatch)
  const resume = useGame((s) => s.resume)
  const deleteHero = useGame((s) => s.deleteHero)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirmForget, setConfirmForget] = useState(false)

  // seats around the fire = each hero + one empty "add" seat, placed on an ellipse from the bottom round
  const seats: Array<{ id: string } | null> = [...slots.map((s) => ({ id: s.id })), null]
  const K = seats.length
  const RX = 330
  const RY = 176
  const seatPos = (i: number) => {
    const angle = Math.PI / 2 + (i / K) * Math.PI * 2 // start at the bottom, go around the fire
    return { x: Math.cos(angle) * RX, y: Math.sin(angle) * RY }
  }

  const selectedSlot = slots.find((s) => s.id === selected)
  const beginJourney = (id: string) => {
    dispatch({ type: 'selectHero', id })
    dispatch({ type: 'navigate', screen: 'worldSelect' })
  }

  return (
    <div className="screen hero-fire centered" style={{ backgroundImage: 'url(/assets/bg-rest-jericho-inn.png)' }}>
      <div className="scrim" />
      <h2 className="fire-title">{t('ui.heroSelect.title')}</h2>
      <p className="fire-flavor muted">{t('ui.heroSelect.flavor')}</p>

      <div className="fire-ring">
        <div className="campfire">
          <span className="campfire-glow" />
          <span className="flame">🔥</span>
        </div>

        {seats.map((seat, i) => {
          const p = seatPos(i)
          const style = { left: `calc(50% + ${p.x}px)`, top: `calc(54% + ${p.y}px)` }
          if (seat === null) {
            return (
              <button key="__new" className="hero-seat empty" style={style} onClick={() => dispatch({ type: 'navigate', screen: 'heroCreation' })}>
                <span className="seat-token">＋</span>
                <span className="seat-name">{t('ui.heroSelect.new')}</span>
              </button>
            )
          }
          const slot = slots.find((s) => s.id === seat.id)!
          const onRoad = resumableIds.includes(slot.id)
          return (
            <button
              key={slot.id}
              className={['hero-seat', selected === slot.id ? 'selected' : '', onRoad ? 'on-road' : ''].join(' ')}
              style={style}
              onClick={() => { setSelected(slot.id); setConfirmForget(false) }}
            >
              <span className="seat-token">🧎</span>
              <span className="seat-name">{slot.character.name}</span>
              <span className="seat-lvl">
                {t('ui.common.level')} {slot.character.level}
                {onRoad ? ` · ${t('ui.heroSelect.onRoad')}` : ''}
              </span>
            </button>
          )
        })}
      </div>

      {selectedSlot ? (
        <div className="fire-actions">
          {resumableIds.includes(selectedSlot.id) && (
            <button className="btn" onClick={() => void resume(selectedSlot.id)}>{t('ui.heroSelect.resume')}</button>
          )}
          <button className="btn primary" onClick={() => beginJourney(selectedSlot.id)}>{t('ui.heroSelect.begin')}</button>
          {confirmForget ? (
            <button className="btn danger" onClick={() => { deleteHero(selectedSlot.id); setSelected(null); setConfirmForget(false) }}>
              {t('ui.heroSelect.forgetConfirm')}
            </button>
          ) : (
            <button className="btn danger small" onClick={() => setConfirmForget(true)}>{t('ui.heroSelect.forget')}</button>
          )}
        </div>
      ) : (
        <p className="fire-hint muted">{slots.length === 0 ? t('ui.heroSelect.firstFlavor') : t('ui.heroSelect.pick')}</p>
      )}

      <button className="btn small fire-back" onClick={() => dispatch({ type: 'navigate', screen: 'start' })}>{t('ui.common.back')}</button>
    </div>
  )
}
