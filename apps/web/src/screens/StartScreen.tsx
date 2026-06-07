import { useTranslation } from 'react-i18next'
import { bgUrl } from '../asset'
import { useGame } from '../store/gameStore'

export function StartScreen() {
  const { t } = useTranslation()
  const locale = useGame((s) => s.state.profile.settings.locale)
  const dispatch = useGame((s) => s.dispatch)
  const continueLast = useGame((s) => s.continueLast)
  const setLocale = useGame((s) => s.setLocale)
  const canContinue = useGame((s) => s.resumableIds.length > 0)

  return (
    <div className="screen start centered" style={{ backgroundImage: bgUrl('bg-menu-startscreen.png') }}>
      <div className="scrim" />
      <h1 className="title">{t('ui.appTitle')}</h1>
      <p className="subtitle">{t('ui.appSubtitle')}</p>

      <div className="start-actions">
        {canContinue && (
          <button className="btn primary block" onClick={() => continueLast()}>
            {t('ui.start.continue')}
          </button>
        )}
        <button className={'btn block' + (canContinue ? '' : ' primary')} onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
          {t('ui.start.enter')}
        </button>
        {/* placeholder — settings menu not wired up yet */}
        <button className="btn block" onClick={() => {}}>
          {t('ui.start.settings')}
        </button>
      </div>

      <div className="lang-toggle">
        <span className="muted">{t('ui.settings.language')}:</span>
        <button className={'btn small' + (locale === 'en' ? ' active' : '')} onClick={() => setLocale('en')}>EN</button>
        <button className={'btn small' + (locale === 'de' ? ' active' : '')} onClick={() => setLocale('de')}>DE</button>
      </div>
    </div>
  )
}
