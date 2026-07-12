import { useTranslation } from 'react-i18next'
import { joinDecision } from '../net'
import { useSession } from '../store/useSession'

// Shown to the HOST when a newcomer asks to join the running game (Look for more). The host decides —
// Accept adds their hero mid-run; Decline turns them away (so a party can refuse someone they'd rather
// not play with). Only the host ever sees this; other players just get the "X joined" notice on accept.
export function JoinRequestModal() {
  const { t } = useTranslation()
  const req = useSession((s) => s.pendingJoin)
  if (!req) return null

  return (
    <div className="modal-overlay coop-overlay">
      <div className="panel narrow coop-panel coop-joinreq">
        <h2>{t('ui.coop.joinReqTitle')}</h2>
        <p className="coop-joinreq-who">
          <b>{req.name}</b>
          <span className="muted"> · {req.heroName} · {t('ui.coop.lv')} {req.heroLevel}</span>
        </p>
        <p className="muted coop-joinreq-hint">{t('ui.coop.joinReqHint')}</p>
        <div className="coop-joinreq-actions">
          <button className="btn primary" onClick={() => joinDecision(req.requestId, true)}>{t('ui.coop.accept')}</button>
          <button className="btn ghost danger" onClick={() => joinDecision(req.requestId, false)}>{t('ui.coop.decline')}</button>
        </div>
      </div>
    </div>
  )
}
