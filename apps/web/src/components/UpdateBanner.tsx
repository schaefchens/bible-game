import { useTranslation } from 'react-i18next'
import { useGame } from '../store/gameStore'
import { useSw } from '../pwa/SwProvider'
import { useInstallCard } from '../pwa/installPrompt'

/**
 * Non-intrusive top-center banner shown when a new build is waiting. Tapping "Reload" activates
 * the new service worker and reloads. Reload is disabled during combat — autosave doesn't run
 * mid-battle, so reloading there would discard the in-progress run; the banner persists until
 * combat ends.
 */
export function UpdateBanner() {
  const { t } = useTranslation()
  const { needRefresh, reload } = useSw()
  const inCombat = useGame((s) => s.state.screen === 'combat')
  // Yield to the ?install=1 card: it is a deep-linked visitor's whole reason for being here, and
  // an update is still waiting for them afterwards.
  const installCardOpen = useInstallCard((s) => s.mode !== 'hidden' && s.mode !== 'waiting')
  if (!needRefresh || installCardOpen) return null
  return (
    <div className="update-banner" role="status">
      <span>{t('ui.update.available')}</span>
      <button className="btn small primary" onClick={reload} disabled={inCombat}>
        {inCombat ? t('ui.update.finishBattle') : t('ui.update.reload')}
      </button>
    </div>
  )
}
