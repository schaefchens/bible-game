import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'

export function HeroCreation() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const createHero = useGame((s) => s.createHero)
  const dispatch = useGame((s) => s.dispatch)

  const begin = () => {
    if (!name.trim()) return
    createHero(name.trim()) // reducer selects the new hero (lastSelectedId)
    dispatch({ type: 'navigate', screen: 'worldSelect' })
  }

  return (
    <div className="screen centered">
      <div className="vignette" />
      <div className="panel narrow">
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
