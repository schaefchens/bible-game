import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { kick } from '../net'
import { useGame } from '../store/gameStore'
import { isHost, useSession } from '../store/useSession'

// A compact, always-visible party list during a co-op run: each teammate with a connection dot (so you
// can see at a glance who is present / has dropped / left). The HOST additionally gets a kick (✕) on every
// other seat — with an inline confirm — to remove a player for good (their hero is downed, they can't
// rejoin). Disconnected players are also handled by the blocking CoopWaitModal; this covers the rest.
export function CoopRoster() {
  const { t } = useTranslation()
  const mpMode = useGame((s) => s.mpMode)
  const phase = useSession((s) => s.phase)
  const roster = useSession((s) => s.roster)
  const playerId = useSession((s) => s.playerId)
  const host = useSession(isHost)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  if (!mpMode || phase !== 'inRun' || roster.length < 2) return null

  return (
    <div className="mp-roster">
      {roster.map((r) => {
        const isMe = r.playerId === playerId
        return (
          <div key={r.playerId} className={'mp-roster-row' + (r.connected ? '' : ' offline')}>
            <span className={'coop-dot' + (r.connected ? ' on' : '')} />
            <span className="mp-roster-name">
              {r.name}
              {r.isHost ? ' 👑' : ''}
              {isMe ? ` · ${t('ui.coop.you')}` : ''}
            </span>
            {host && !isMe &&
              (confirmId === r.playerId ? (
                <>
                  <button className="btn tiny danger" onClick={() => { kick(r.playerId); setConfirmId(null) }}>{t('ui.coop.kickYes')}</button>
                  <button className="btn tiny ghost" onClick={() => setConfirmId(null)}>{t('ui.coop.kickNo')}</button>
                </>
              ) : (
                <button className="btn tiny ghost mp-roster-kick" title={t('ui.coop.kick', { name: r.name })} onClick={() => setConfirmId(r.playerId)}>✕</button>
              ))}
          </div>
        )
      })}
    </div>
  )
}
