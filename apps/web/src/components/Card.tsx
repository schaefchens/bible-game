import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import type { HandCardView } from '../selectors'

// A held card in the fanned hand. The resting fan transform (x/y/rotate) is supplied by the
// combat screen; hovering or selecting lifts the card upright above the fan. Framer owns the
// transform (so no CSS-transform centring to clobber).
export function CardView({
  card,
  playable,
  selected,
  onClick,
  fan,
  z,
  flyTo,
  reduced,
}: {
  card: HandCardView
  playable: boolean
  selected: boolean
  onClick: () => void
  fan: { x: number; y: number; rotate: number }
  z: number
  // when set, the card flies toward this point on play (enemy-targeted) instead of straight up
  flyTo?: { x: number; y: number }
  reduced?: boolean
}) {
  const { t } = useTranslation()
  const verse = card.type === 'verse'
  const lifted = { x: fan.x, y: -72, rotate: 0, scale: 1.18, zIndex: 50, opacity: 1 }
  const rest = { x: fan.x, y: fan.y, rotate: fan.rotate, scale: 1, zIndex: z, opacity: 1 }
  // Play exit: a quick fade for reduced motion, else launch toward the target (enemy) or up (self).
  const exit = reduced
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
      className={['card', card.layer, playable ? 'playable' : 'unplayable', selected ? 'selected' : '', verse ? 'verse' : ''].join(' ')}
      onClick={onClick}
      disabled={!playable && !selected}
      initial={{ opacity: 0, x: fan.x, y: 130, rotate: fan.rotate }}
      animate={selected ? lifted : rest}
      exit={exit}
      whileHover={playable && !selected ? lifted : undefined}
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
      <div className={'card-art ' + card.layer} />
      <div className="card-name">{t(card.nameKey)}</div>
      <div className="card-text">{t(card.textKey, card.values)}</div>
    </motion.button>
  )
}
