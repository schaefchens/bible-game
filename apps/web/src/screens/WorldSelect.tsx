import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'

export function WorldSelect() {
  const { t } = useTranslation()
  const lastSelectedId = useGame((s) => s.state.profile.lastSelectedId)
  const startRun = useGame((s) => s.startRun)
  const dispatch = useGame((s) => s.dispatch)

  return (
    <div className="screen centered">
      <div className="vignette" />
      <div className="panel narrow">
        <h2>{t('ui.worldSelect.title')}</h2>
        <div className="world-card" style={{ backgroundImage: 'url(/assets/bg-road-dusty-road.png)' }}>
          <div className="world-card-body">
            <h3>{t('ui.worldSelect.world01.title')}</h3>
            <p className="muted">{t('ui.worldSelect.world01.subtitle')}</p>
          </div>
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
            {t('ui.common.back')}
          </button>
          <button className="btn primary" disabled={!lastSelectedId} onClick={() => lastSelectedId && startRun(lastSelectedId)}>
            {t('ui.worldSelect.begin')}
          </button>
        </div>
      </div>
    </div>
  )
}
