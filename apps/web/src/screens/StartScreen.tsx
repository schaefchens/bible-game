import { useTranslation } from 'react-i18next'
import { bgUrl } from '../asset'
import { openCoop, reconnectCoop } from '../net'
import { useGame } from '../store/gameStore'
import { loadSavedSession } from '../store/useSession'

export function StartScreen() {
  const { t } = useTranslation()
  const locale = useGame((s) => s.state.profile.settings.locale)
  const dispatch = useGame((s) => s.dispatch)
  const continueLast = useGame((s) => s.continueLast)
  const setLocale = useGame((s) => s.setLocale)
  const canContinue = useGame((s) => s.resumableIds.length > 0)
  const hasHeroes = useGame((s) => s.state.profile.slots.length > 0)
  const canReconnect = loadSavedSession() !== null

  return (
    <div className="screen start centered" style={{ backgroundImage: bgUrl('bg-menu-startscreen.webp') }}>
      <div className="scrim" />
      <h1 className="title">{t('ui.appTitle')}</h1>
      <p className="subtitle">{t('ui.appSubtitle')}</p>

      <div className="start-actions">
        {/* Order: continue co-op, then continue offline, then start-new (only when neither is available),
            then the fire, then the rest. */}
        {canReconnect && (
          <button className="btn block coop-reconnect" onClick={() => reconnectCoop()}>
            ↻ {t('ui.coop.reconnect')}
          </button>
        )}
        {canContinue && (
          <button className="btn primary block" onClick={() => continueLast()}>
            {t('ui.start.continue')}
          </button>
        )}
        {/* Beginner shortcut: when there's nothing to continue (no single-player run and no co-op game to
            reconnect to), a clearly-labeled "Start New Game" with its own colour — new players don't know
            what "Around the Fire" means. Does the same as the fire entry: go to hero selection. */}
        {!canContinue && !canReconnect && (
          <button className="btn block start-new" onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
            {t('ui.start.newGame')}
          </button>
        )}
        {/* The fire = manage/pick your existing pilgrims. Hidden when you have none — nothing to gather
            around yet; the "Start New Game" button takes a newcomer there to create their first hero. */}
        {hasHeroes && (
          <button className={'btn block' + (canContinue ? '' : ' primary')} onClick={() => dispatch({ type: 'navigate', screen: 'heroSelect' })}>
            {t('ui.start.enter')}
          </button>
        )}
        <button className="btn block" onClick={() => openCoop()}>
          {t('ui.coop.play')}
        </button>
        <button className="btn block" onClick={() => dispatch({ type: 'navigate', screen: 'settings' })}>
          {t('ui.start.settings')}
        </button>
      </div>

      <div className="lang-toggle">
        <span className="muted">{t('ui.settings.language')}:</span>
        <button className={'btn small' + (locale === 'en' ? ' active' : '')} onClick={() => setLocale('en')}>EN</button>
        <button className={'btn small' + (locale === 'de' ? ' active' : '')} onClick={() => setLocale('de')}>DE</button>
      </div>

      {/* subtle nod to the game's composer — bottom-centered, deliberately understated */}
      <a className="support-link" href="https://buymeacoffee.com/missellelive" target="_blank" rel="noopener noreferrer">
        {t('ui.start.support')}
      </a>

      <span className="app-version">v{__APP_VERSION__}</span>
    </div>
  )
}
