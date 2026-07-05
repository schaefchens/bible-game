import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectFireplace, selectUpgradeable } from '../selectors'
import { CardFace } from '../components/CardFace'

export function FireplaceScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectFireplace(state), [state])
  const upgradeable = useMemo(() => selectUpgradeable(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const setSleeping = useGame((s) => s.setSleeping)
  const setPraying = useGame((s) => s.setPraying)
  const mpMode = useGame((s) => s.mpMode)
  const lastEvents = useGame((s) => s.lastEvents)
  const [pickMode, setPickMode] = useState<'upgrade' | 'study' | null>(null)
  const [selIdx, setSelIdx] = useState<number | null>(null)
  if (!view) return null

  const selected = selIdx != null ? (upgradeable.find((u) => u.index === selIdx) ?? null) : null

  // Resting = sleeping: heal, and play the fade-to-black sleep cinematic (cue + music dip). In co-op the
  // cinematic is driven by the broadcast event (applyServerState) so ALL players see it — not just here.
  const rest = () => {
    if (!mpMode) setSleeping(true)
    dispatch({ type: 'world/fireplace', action: 'rest' })
  }
  // Praying: lift the Spirit, and open the golden prayer cinematic (psalms crawl until "Amen").
  const pray = () => {
    if (!mpMode) setPraying(true)
    dispatch({ type: 'world/fireplace', action: 'pray' })
  }
  const openPicker = () => {
    setSelIdx(null)
    setPickMode('upgrade')
  }
  const closePicker = () => {
    setSelIdx(null)
    setPickMode(null)
  }
  const confirmUpgrade = () => {
    if (selected) dispatch({ type: 'world/fireplace', action: 'upgrade', cardIndex: selected.index })
    closePicker()
  }
  // Study a chosen Scripture Fragment → opens its gap-fill (VerseModal, via the prompt).
  const studyFragment = (fragmentId: string) => {
    dispatch({ type: 'world/fireplace', action: 'study', fragmentId })
    setPickMode(null)
  }

  const notice = lastEvents.flatMap((e) => (e.type === 'notice' ? [e.messageKey] : [])).at(-1)

  return (
    <div className="screen fireplace centered" style={{ backgroundImage: assetBg(view.bgAsset) }}>
      {!view.bgAsset && <div className="firelight" />}
      <div className="scrim" />
      <div className={'panel narrow fireplace-panel' + (pickMode === 'upgrade' && !selected && upgradeable.length > 0 ? ' picking' : '')}>
        <h2>{t(view.nameKey)}</h2>
        <p className="muted reflect">{t(view.reflectKey)}</p>
        {notice && !pickMode && <p className="muted">{t(notice)}</p>}

        {pickMode === null ? (
          <div className="choices">
            <button className="btn block" disabled={view.rested} onClick={rest}>
              {t('ui.fireplace.rest')}
            </button>
            <button className="btn block" disabled={view.prayed} onClick={pray}>
              {t('ui.fireplace.pray')}
            </button>
            <button className="btn block" disabled={view.fragments.length === 0} onClick={() => setPickMode('study')}>
              {t('ui.fireplace.study')}
            </button>
            <button className="btn block" disabled={view.upgraded || !view.canUpgrade} onClick={openPicker}>
              {t('ui.fireplace.upgrade')}
            </button>
            <button className="btn primary block" onClick={() => dispatch({ type: 'world/fireplace', action: 'leave' })}>
              {t('ui.fireplace.leave')}
            </button>
          </div>
        ) : pickMode === 'study' ? (
          // pick which Scripture Fragment to study (each opens its gap-fill; solving unlocks the card)
          <>
            <h3 className="reward-card-title">{t('ui.fireplace.studyPick')}</h3>
            <div className="choices">
              {view.fragments.map((f) => (
                <button key={f.itemId} className="btn block" onClick={() => studyFragment(f.itemId)}>
                  {t(f.nameKey)}
                </button>
              ))}
            </div>
            <button className="btn block" onClick={() => setPickMode(null)}>
              {t('ui.fireplace.cancel')}
            </button>
          </>
        ) : selected ? (
          // chosen a card → show what it becomes, confirm or go back
          <>
            <h3 className="reward-card-title">{t('ui.fireplace.upgradePreviewTitle')}</h3>
            <div className="upgrade-preview">
              <CardFace cost={selected.cost} layer={selected.layer} nameKey={selected.nameKey} textKey={selected.textKey} values={selected.values} verse={selected.verse} rarity={selected.rarity} />
              <span className="upgrade-arrow" aria-hidden>→</span>
              <CardFace cost={selected.toCost} layer={selected.toLayer} nameKey={selected.toNameKey} textKey={selected.toTextKey} values={selected.toValues} verse={selected.verse} rarity={selected.rarity} selected />
            </div>
            <button className="btn primary block" onClick={confirmUpgrade}>
              {t('ui.fireplace.upgradeConfirm')}
            </button>
            <button className="btn block" onClick={() => setSelIdx(null)}>
              {t('ui.fireplace.cancel')}
            </button>
          </>
        ) : (
          // pick which card to hone — shown in their CURRENT state
          <>
            <h3 className="reward-card-title">{t('ui.fireplace.upgradeTitle')}</h3>
            {upgradeable.length === 0 ? (
              <p className="muted">{t('ui.fireplace.upgradeNone')}</p>
            ) : (
              <div className="card-row">
                {upgradeable.map((u) => (
                  <CardFace key={u.index} cost={u.cost} layer={u.layer} nameKey={u.nameKey} textKey={u.textKey} values={u.values} verse={u.verse} rarity={u.rarity} onClick={() => setSelIdx(u.index)} />
                ))}
              </div>
            )}
            <button className="btn block" onClick={closePicker}>
              {t('ui.fireplace.cancel')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
