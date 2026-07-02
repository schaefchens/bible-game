import { useTranslation } from 'react-i18next'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'

// The selectable adventures. Tutorial first (always open); later worlds stay locked until the world
// named in `unlockedBy` has been completed (its boss beaten). Title/subtitle are i18n keys.
interface WorldCard {
  id: string
  titleKey: string
  subtitleKey: string
  bg: string
  tagKey?: string
  unlockedBy?: string
}
// Progression: tutorial (world-02) → both Valley of Elah (world-03) and The Road to Jericho (world-01)
// unlock together once the tutorial is completed.
const WORLDS: WorldCard[] = [
  { id: 'world-02', titleKey: 'ui.worldSelect.world02.title', subtitleKey: 'ui.worldSelect.world02.subtitle', bg: 'bg-rest-old-cistern.webp', tagKey: 'ui.worldSelect.tutorialTag' },
  { id: 'world-03', titleKey: 'ui.worldSelect.world03.title', subtitleKey: 'ui.worldSelect.world03.subtitle', bg: 'bg-combat-rocky-pass.webp', unlockedBy: 'world-02' },
  { id: 'world-01', titleKey: 'ui.worldSelect.world01.title', subtitleKey: 'ui.worldSelect.world01.subtitle', bg: 'bg-road-dusty-road.webp', unlockedBy: 'world-02' },
]

export function WorldSelect() {
  const { t } = useTranslation()
  const lastSelectedId = useGame((s) => s.state.profile.lastSelectedId)
  const completedWorlds = useGame((s) => s.state.profile.completedWorlds)
  const startRun = useGame((s) => s.startRun)
  const dispatch = useGame((s) => s.dispatch)

  return (
    <div className="screen centered">
      <div className="vignette" />
      <div className="panel world-panel">
        <h2>{t('ui.worldSelect.title')}</h2>
        <div className="world-cards">
          {WORLDS.map((w) => {
            const locked = !!w.unlockedBy && !completedWorlds.includes(w.unlockedBy)
            return (
              <div key={w.id} className={'world-card' + (locked ? ' locked' : '')} style={{ backgroundImage: bgUrl(w.bg) }}>
                <div className="world-card-body">
                  {w.tagKey && <span className="world-tag">{t(w.tagKey)}</span>}
                  <h3>{t(w.titleKey)}</h3>
                  <p className="muted">{locked ? t('ui.worldSelect.locked') : t(w.subtitleKey)}</p>
                  <button
                    className="btn primary"
                    disabled={locked || !lastSelectedId}
                    onClick={() => !locked && lastSelectedId && startRun(lastSelectedId, w.id)}
                  >
                    {locked ? `🔒 ${t('ui.worldSelect.begin')}` : t('ui.worldSelect.begin')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
            {t('ui.common.back')}
          </button>
        </div>
      </div>
    </div>
  )
}
