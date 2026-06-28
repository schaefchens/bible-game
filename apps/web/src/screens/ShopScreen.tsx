import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { assetBg } from '@bible/assets'
import { resolveAsset } from '@bible/assets'
import { useGame } from '../store/gameStore'
import { selectShop } from '../selectors'
import { CardFace } from '../components/CardFace'
import { KIND_ICON } from '../components/InventoryPanel'

export function ShopScreen() {
  const { t } = useTranslation()
  const state = useGame((s) => s.state)
  const view = useMemo(() => selectShop(state), [state])
  const dispatch = useGame((s) => s.dispatch)
  const [removing, setRemoving] = useState(false)
  if (!view) return null

  const buyCard = (defId: string) => dispatch({ type: 'world/shopBuyCard', nodeId: view.nodeId, defId })
  const buyItem = (itemId: string) => dispatch({ type: 'world/shopBuyItem', nodeId: view.nodeId, itemId })
  const remove = (cardIndex: number) => {
    dispatch({ type: 'world/shopRemoveCard', nodeId: view.nodeId, cardIndex })
    setRemoving(false)
  }

  return (
    <div className="screen shop centered" style={{ backgroundImage: assetBg(view.bgAsset) }}>
      <div className="scrim" />
      <div className="panel shop-panel">
        {/* fixed head: title + purse (never scrolls) */}
        <div className="shop-head">
          <h2>{t(view.nameKey)}</h2>
          <p className="muted">
            {t('ui.shop.gold', { amount: view.gold })}
            {view.deckFull && <span className="warn"> · {t('ui.shop.deckFull')}</span>}
          </p>
        </div>

        {/* scrolling body */}
        <div className="shop-body">
          {removing ? (
            <>
              <h3 className="reward-card-title">{t('ui.shop.removeTitle', { price: view.removePrice })}</h3>
              <div className="card-row">
                {view.deck.map((c) => (
                  <CardFace
                    key={c.index}
                    cost={c.cost}
                    layer={c.layer}
                    nameKey={c.nameKey}
                    textKey=""
                    verse={c.verse}
                    rarity={c.rarity}
                    disabled={!view.canRemove}
                    onClick={view.canRemove ? () => remove(c.index) : undefined}
                  />
                ))}
              </div>
            </>
          ) : (
            // split layout: cards take the wide (≈2/3) column, items the narrow (≈1/3) column
            <div className="shop-split">
              <div className="shop-col">
                <h3 className="reward-card-title">{t('ui.shop.cards')}</h3>
                {view.cards.length === 0 ? (
                  <p className="muted">{t('ui.shop.empty')}</p>
                ) : (
                  <div className="card-row">
                    {view.cards.map((c) => (
                      <div key={c.defId} className="shop-buy">
                        <CardFace
                          cost={c.cost}
                          layer={c.layer}
                          nameKey={c.nameKey}
                          textKey={c.textKey}
                          values={c.values}
                          verse={c.verse}
                          rarity={c.rarity}
                          disabled={c.sold || !c.affordable}
                          onClick={!c.sold && c.affordable ? () => buyCard(c.defId) : undefined}
                        />
                        <span className="shop-price">{c.sold ? t('ui.shop.sold') : t('ui.shop.price', { amount: c.price })}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="shop-col shop-col-items">
                <h3 className="reward-card-title">{t('ui.shop.items')}</h3>
                {view.items.length === 0 ? (
                  <p className="muted">{t('ui.shop.empty')}</p>
                ) : (
                  <div className="card-row shop-item-grid">
                    {view.items.map((it) => {
                      const url = resolveAsset(it.icon)
                      return (
                        <div key={it.itemId} className="shop-item">
                          <button
                            className="inv-slot"
                            disabled={it.sold || !it.affordable}
                            onClick={() => buyItem(it.itemId)}
                            aria-label={t(it.nameKey)}
                          >
                            {url ? <img src={url} alt="" /> : <span className="inv-glyph">{KIND_ICON[it.kind] ?? '❔'}</span>}
                          </button>
                          <span className="shop-price">{it.sold ? t('ui.shop.sold') : t('ui.shop.price', { amount: it.price })}</span>
                          {/* hover/tap info box (name + desc), like the bag's tooltip */}
                          <div className="inv-tooltip shop-tip">
                            <span className="name">{t(it.nameKey)}</span>
                            {it.descKey && <span className="desc">{t(it.descKey)}</span>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
                {/* remove-a-card lives under the goods so the footer is a single button (less height → no scroll) */}
                <button className="btn block shop-remove-btn" disabled={view.deck.length === 0} onClick={() => setRemoving(true)}>
                  {t('ui.shop.remove', { price: view.removePrice })}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* fixed footer: actions (never scroll) */}
        <div className="shop-foot">
          {removing ? (
            <button className="btn block" onClick={() => setRemoving(false)}>{t('ui.shop.back')}</button>
          ) : (
            <button className="btn primary block" onClick={() => dispatch({ type: 'world/leaveShop' })}>
              {t('ui.shop.leave')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
