import { motion } from 'framer-motion'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { HandCardView } from '../selectors'

// How far the resting hand is tucked DOWN past the bottom edge — only the title + upper art peek
// above the "ground"; hovering or selecting lifts the card fully into view (Slay-the-Spire hand).
const REST_TUCK = 80

// A held card in the fanned hand. The resting fan transform (x/y/rotate) is supplied by the
// combat screen; hovering or selecting lifts the card upright above the fan. Framer owns the
// transform (so no CSS-transform centring to clobber).
export function CardView({
  card,
  playable,
  selected,
  onPointerDown,
  fan,
  z,
  flyTo,
  reduced,
  dragging,
}: {
  card: HandCardView
  playable: boolean
  selected: boolean
  // press to either tap (select/play) or drag — the combat screen routes both via the drag hook
  onPointerDown: (e: ReactPointerEvent) => void
  fan: { x: number; y: number; rotate: number }
  z: number
  // when set, the card flies toward this point on play (enemy-targeted) instead of straight up
  flyTo?: { x: number; y: number }
  reduced?: boolean
  // this card is currently being dragged (its ghost follows the cursor) — dim it, suppress hover
  dragging?: boolean
}) {
  const { t } = useTranslation()
  const verse = card.type === 'verse'
  // gentle low raise: the selected/hovered card pops just above the resting hand (title + art read
  // clearly; the lower description may sit under the bottom edge) rather than flying up the screen
  const lifted = { x: fan.x, y: 18, rotate: 0, scale: 1.06, zIndex: 50, opacity: 1 }
  const rest = { x: fan.x, y: fan.y + REST_TUCK, rotate: fan.rotate, scale: 1, zIndex: z, opacity: dragging ? 0.16 : 1 }
  // Play exit: dragged cards fade quietly (the ghost carries the slingshot); reduced motion fades;
  // otherwise launch toward the target (enemy) or up (self).
  const exit = dragging
    ? { opacity: 0, scale: 0.9, transition: { duration: 0.12 } }
    : reduced
    ? { opacity: 0, transition: { duration: 0.12 } }
    : {
        opacity: 0,
        x: flyTo ? flyTo.x : fan.x,
        y: flyTo ? flyTo.y : -190,
        scale: flyTo ? 0.55 : 0.7,
        rotate: 0,
        transition: { duration: flyTo ? 0.36 : 0.28 },
      }
  return (
    <motion.button
      className={['card', card.layer, 'rarity-' + card.rarity, playable ? 'playable' : 'unplayable', selected ? 'selected' : '', verse ? 'verse' : '', dragging ? 'dragging' : ''].join(' ')}
      onPointerDown={onPointerDown}
      disabled={!playable && !selected}
      initial={{ opacity: 0, x: fan.x, y: 130, rotate: fan.rotate }}
      animate={selected ? lifted : rest}
      exit={exit}
      whileHover={playable && !selected && !dragging ? lifted : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      <div className="card-cost">{card.cost}</div>
      {card.damage && (
        <div className={'card-damage ' + (card.damage.spiritual ? 'spirit' : 'flesh')}>
          {card.damage.spiritual ? '✨' : '⚔'} {card.damage.perHit}
          {card.damage.hits > 1 ? <span className="hits">×{card.damage.hits}</span> : null}
        </div>
      )}
      {card.miracle && (
        <div className="card-damage spirit">
          {card.miracle.kind === 'banish' ? '✨' : '🛡✨'} {Math.round(card.miracle.chance * 100)}%
        </div>
      )}
      <div className="card-name">{t(card.nameKey)}</div>
      <div className={'card-art ' + card.layer} />
      <div className="card-text">{t(card.textKey, card.values)}</div>
    </motion.button>
  )
}
