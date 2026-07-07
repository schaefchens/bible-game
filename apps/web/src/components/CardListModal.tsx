import { useState, type CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { CardFace } from './CardFace'
import { OwnerLegend } from './OwnerLegend'
import type { CardRarity } from '../selectors'

/**
 * A read-only modal listing a set of cards (a combat pile, or the run deck). Reuses the menu
 * `CardFace` + the shared `.modal-overlay` / `.panel` / `.card-row` chrome. Honed copies get a small
 * gold mark; clutter (unplayable) copies are dimmed. Clicking a card opens an enlarged detail view
 * (big card + its long-form description); clicking the backdrop or ✕ closes the modal.
 */
export interface ModalCard {
  iid?: string
  nameKey: string
  textKey: string
  /** optional long-form lore shown in the enlarged detail view */
  descKey?: string
  cost: number
  layer: 'flesh' | 'spirit' | 'both'
  verse?: boolean
  rarity?: CardRarity
  values?: Record<string, number>
  honed?: boolean
  unplayable?: boolean
  /** co-op: the owning player's color + identity shape (border tint + corner badge; name is in the legend) */
  ownerColor?: string
  ownerSymbol?: string
}

export function CardListModal({ titleKey, cards, legend, onClose }: { titleKey: string; cards: ModalCard[]; legend?: { name: string; color: string; symbol: string }[]; onClose: () => void }) {
  const { t } = useTranslation()
  const [detail, setDetail] = useState<ModalCard | null>(null)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        className="panel world-panel deck-modal"
        initial={{ y: 24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="deck-modal-head">
          <h3>{t(titleKey)} <span className="muted">· {cards.length}</span></h3>
          <button className="hud-icon-btn" onClick={onClose} aria-label={t('ui.common.close')}>✕</button>
        </div>
        {legend && <OwnerLegend owners={legend} />}
        {cards.length === 0 ? (
          <p className="muted deck-modal-empty">{t('ui.deck.empty')}</p>
        ) : (
          <div className="card-row">
            {cards.map((c, i) => (
              <div
                key={c.iid ?? `${c.nameKey}-${i}`}
                className={['modal-card', c.honed ? 'honed' : '', c.unplayable ? 'unplayable' : '', c.ownerColor ? 'owned' : ''].join(' ')}
                style={c.ownerColor ? ({ '--owner': c.ownerColor } as CSSProperties) : undefined}
              >
                <CardFace cost={c.cost} layer={c.layer} nameKey={c.nameKey} textKey={c.textKey} values={c.values} verse={c.verse} rarity={c.rarity} ownerSymbol={c.ownerSymbol} ownerColor={c.ownerColor} onClick={() => setDetail(c)} />
                {c.honed && <span className="modal-card-badge" title={t('ui.deck.honed')}>✦</span>}
              </div>
            ))}
          </div>
        )}
      </motion.div>

      {/* enlarged detail view — the card "turned around" with its full description */}
      {detail && (
        <div className="card-detail-overlay" onClick={(e) => { e.stopPropagation(); setDetail(null) }}>
          <motion.div className="card-detail" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-detail-big">
              <CardFace cost={detail.cost} layer={detail.layer} nameKey={detail.nameKey} textKey={detail.textKey} values={detail.values} verse={detail.verse} rarity={detail.rarity} />
            </div>
            <div className="card-detail-body">
              <h4>{t(detail.nameKey)}</h4>
              <p className="card-detail-text">{t(detail.textKey, detail.values)}</p>
              {detail.descKey && <p className="card-detail-desc">{t(detail.descKey)}</p>}
              <button className="btn small card-detail-close" onClick={() => setDetail(null)}>{t('ui.common.close')}</button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}
