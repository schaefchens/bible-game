import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'

export function GameOverScreen() {
  const { t } = useTranslation()
  const abandon = useGame((s) => s.abandon)

  return (
    <div className="screen gameover centered">
      <div className="vignette dark" />
      <div className="panel narrow">
        <h2>{t('ui.gameOver.title')}</h2>
        <p className="muted">{t('ui.gameOver.flavor')}</p>
        <button className="btn primary block" onClick={() => void abandon()}>
          {t('ui.gameOver.restart')}
        </button>
      </div>
    </div>
  )
}
