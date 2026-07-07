import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { CardRarity } from '../selectors'
import { cardArt } from '../cardArt'

/**
 * A plain (motion-free) card face for menu contexts — reward picks, the fireplace upgrade picker,
 * and the shop. Reuses the combat card's CSS classes (.card / .card-cost / .card-art / .card-name /
 * .card-text) but without the fan/hover lift. `Card.tsx` stays the combat-specific fanned variant.
 */
export interface CardFaceProps {
  cost: number
  layer: 'flesh' | 'spirit' | 'both'
  nameKey: string
  textKey: string
  /** verse cards get the special frame */
  verse?: boolean
  /** drives the ornament-frame colour (starter/common/uncommon/rare); defaults to common */
  rarity?: CardRarity
  /** optional combat badges (so the drag ghost matches the fanned hand card) */
  damage?: { perHit: number; hits: number; spiritual: boolean }
  miracle?: { kind: 'banish' | 'protect'; chance: number; turns?: number }
  /** scaled values for interpolating the card text (dmg/block/heal/chance) */
  values?: Record<string, number>
  selected?: boolean
  /** the keyboard cursor is on this card (a raised ring, distinct from `selected`) */
  focused?: boolean
  disabled?: boolean
  /** co-op: the owning player's identity shape + color, overlaid centered over the card art */
  ownerSymbol?: string
  ownerColor?: string
  onClick?: () => void
}

export function CardFace({ cost, layer, nameKey, textKey, values, verse, rarity, damage, miracle, selected, focused, disabled, ownerSymbol, ownerColor, onClick }: CardFaceProps) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className={['card', 'card-face', layer, 'rarity-' + (rarity ?? 'common'), selected ? 'selected' : '', focused ? 'focused' : '', verse ? 'verse' : '', ownerColor ? 'owned' : ''].join(' ')}
      style={ownerColor ? ({ '--owner': ownerColor } as CSSProperties) : undefined}
      onClick={onClick}
      disabled={disabled || !onClick}
    >
      <div className="card-cost">{cost}</div>
      {damage && (
        <div className={'card-damage ' + (damage.spiritual ? 'spirit' : 'flesh')}>
          {damage.spiritual ? '✨' : '⚔'} {damage.perHit}
          {damage.hits > 1 ? <span className="hits">×{damage.hits}</span> : null}
        </div>
      )}
      {miracle && (
        <div className="card-damage spirit">
          {miracle.kind === 'banish' ? '✨' : '🛡✨'} {Math.round(miracle.chance * 100)}%
        </div>
      )}
      <div className="card-name">{t(nameKey)}</div>
      <div className={'card-art ' + layer}>
        <span className="card-art-glyph">{cardArt(nameKey, layer)}</span>
        {ownerSymbol && <span className="owner-symbol card-owner-symbol">{ownerSymbol}</span>}
      </div>
      <div className="card-text">{t(textKey, values)}</div>
    </button>
  )
}
