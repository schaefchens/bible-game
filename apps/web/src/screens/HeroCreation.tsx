import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CLASS_IDS, HERO_CLASSES, type ClassId } from '@bible/engine'
import { useGame } from '../store/gameStore'

// Icon per class (art can replace these later, like the battle sprites).
const CLASS_ICON: Record<ClassId, string> = { zealot: '⚔️', shepherd: '🐑', merchant: '💰' }

export function HeroCreation() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [classId, setClassId] = useState<ClassId>('shepherd')
  const createHero = useGame((s) => s.createHero)
  const dispatch = useGame((s) => s.dispatch)

  const begin = () => {
    if (!name.trim()) return
    createHero(name.trim(), classId) // reducer selects the new hero (lastSelectedId)
    dispatch({ type: 'navigate', screen: 'worldSelect' })
  }

  return (
    <div className="screen centered">
      <div className="vignette" />
      <div className="panel narrow hero-create">
        <h2>{t('ui.heroCreation.title')}</h2>
        <p className="muted">{t('ui.heroCreation.flavor')}</p>
        <input
          className="text-input"
          autoFocus
          value={name}
          maxLength={24}
          placeholder={t('ui.heroCreation.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && begin()}
        />

        <p className="muted class-choose">{t('ui.heroCreation.chooseClass')}</p>
        <div className="class-picker">
          {CLASS_IDS.map((id) => {
            const def = HERO_CLASSES[id]
            return (
              <button
                key={id}
                className={'class-card' + (classId === id ? ' selected' : '')}
                onClick={() => setClassId(id)}
                aria-pressed={classId === id}
              >
                <span className="class-icon">{CLASS_ICON[id]}</span>
                <span className="class-name">{t(`ui.heroClass.${id}.name`)}</span>
                <span className="class-tagline muted">{t(`ui.heroClass.${id}.tagline`)}</span>
                <span className="class-stats muted">
                  ❤️ {def.baseHp} · ⚔️ ×{def.power} · 💰 {def.startGold}
                </span>
                <span className="class-perk">{t(`ui.heroClass.${id}.perk`)}</span>
              </button>
            )
          })}
        </div>

        <div className="row gap">
          <button className="btn" onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
            {t('ui.common.back')}
          </button>
          <button className="btn primary" disabled={!name.trim()} onClick={begin}>
            {t('ui.heroCreation.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
