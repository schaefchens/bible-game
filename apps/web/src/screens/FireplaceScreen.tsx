import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectFireplace } from '../selectors'

export function FireplaceScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectFireplace(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const setSleeping = useGame((s) => s.setSleeping)
  const setPraying = useGame((s) => s.setPraying)
  const lastEvents = useGame((s) => s.lastEvents)
  if (!view) return null

  // Resting = sleeping: heal, and play the fade-to-black sleep cinematic (cue + music dip).
  const rest = () => {
    setSleeping(true)
    dispatch({ type: 'world/fireplace', action: 'rest' })
  }
  // Praying: lift the Spirit, and open the golden prayer cinematic (psalms crawl until "Amen").
  const pray = () => {
    setPraying(true)
    dispatch({ type: 'world/fireplace', action: 'pray' })
  }

  const notice = lastEvents.flatMap((e) => (e.type === 'notice' ? [e.messageKey] : [])).at(-1)

  return (
    <div className="screen fireplace centered" style={{ backgroundImage: assetBg(view.bgAsset) }}>
      {!view.bgAsset && <div className="firelight" />}
      <div className="scrim" />
      <div className="panel narrow">
        <h2>{t(view.nameKey)}</h2>
        <p className="muted reflect">{t(view.reflectKey)}</p>
        {notice && <p className="muted">{t(notice)}</p>}
        <div className="choices">
          <button className="btn block" disabled={view.rested} onClick={rest}>
            {t('ui.fireplace.rest')}
          </button>
          <button className="btn block" disabled={view.prayed} onClick={pray}>
            {t('ui.fireplace.pray')}
          </button>
          <button className="btn block" disabled={!view.verseAvailable} onClick={() => dispatch({ type: 'world/fireplace', action: 'study' })}>
            {t('ui.fireplace.study')}
          </button>
          <button className="btn primary block" onClick={() => dispatch({ type: 'world/fireplace', action: 'leave' })}>
            {t('ui.fireplace.leave')}
          </button>
        </div>
      </div>
    </div>
  )
}
