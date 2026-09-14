import { useTranslation } from 'react-i18next'
import { detectPlatform, endInstallFlow, requestInstall, useInstallCard } from '../pwa/installPrompt'

/**
 * The card behind the `?install=1` deep link. Renders nothing on a normal visit.
 *
 * This file is only the surface — every timing rule lives in pwa/installPrompt.ts. Two shapes:
 * one button that fires the browser's real install dialog straight out of a click (the only thing
 * that reliably works, because a link click's user activation does not survive the navigation), or
 * written, platform-specific instructions for browsers with no install API at all.
 */
export function InstallCard() {
  const { t } = useTranslation()
  const mode = useInstallCard((s) => s.mode)
  const busy = useInstallCard((s) => s.busy)

  // 'waiting' is the deadline window in which a late beforeinstallprompt may still turn up — it
  // deliberately shows nothing rather than flashing instructions we're about to replace.
  if (mode === 'hidden' || mode === 'waiting') return null

  // Never close out from under an open browser dialog: the result still has to land.
  const close = (): void => {
    if (!busy) endInstallFlow()
  }

  return (
    <div className="modal-overlay install-overlay" onClick={close}>
      <div className="panel narrow install-card" onClick={(e) => e.stopPropagation()}>
        {mode === 'done' ? (
          <>
            <h3>{t('ui.install.doneTitle')}</h3>
            <p className="muted">{t('ui.install.done')}</p>
            <div className="row gap">
              <button className="btn small primary" onClick={close}>{t('ui.common.close')}</button>
            </div>
          </>
        ) : (
          <>
            <h3>{t('ui.install.title')}</h3>
            <p className="muted">
              {mode === 'button' ? t('ui.install.body') : t(`ui.install.howto.${detectPlatform()}`)}
            </p>
            <div className="row gap">
              {mode === 'button' && (
                <button className="btn small primary" onClick={requestInstall} disabled={busy}>
                  {t('ui.install.action')}
                </button>
              )}
              <button className="btn small" onClick={close}>
                {mode === 'button' ? t('ui.install.later') : t('ui.common.close')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
