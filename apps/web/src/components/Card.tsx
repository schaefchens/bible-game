import { motion } from 'framer-motion'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { HandCardView } from '../selectors'
import { cardArt } from '../cardArt'

// How far the resting hand is tucked DOWN past the bottom edge — only the title + upper art peek
// above the "ground"; hovering or selecting lifts the card fully into view (Slay-the-Spire hand).
const REST_TUCK = 112

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
  aiming,
  launched,
  peerLabel,
  ownerColor,
  ownerSymbol,
  onHover,
}: {
  card: HandCardView
  playable: boolean
  selected: boolean
  /** co-op: a teammate is eyeing this card right now — glow + their name (non-authoritative) */
  peerLabel?: string
  /** co-op: the owning player's color + identity shape (border tint + corner badge) */
  ownerColor?: string
  ownerSymbol?: string
  /** co-op: report local hover so it can be relayed to teammates */
  onHover?: (hovering: boolean) => void
  // press to either tap (select/play) or drag — the combat screen routes both via the drag hook
  onPointerDown: (e: ReactPointerEvent) => void
  fan: { x: number; y: number; rotate: number }
  z: number
  // when set, the card flies toward this point on play (enemy-targeted) instead of straight up
  flyTo?: { x: number; y: number }
  reduced?: boolean
  // this card is currently being aimed (the targeting arrow drags from it) — highlight, suppress hover
  aiming?: boolean
  // this card has been launched: its copy is mid-flight to the target, so hide it in the hand (the
  // real card is removed once the flying copy lands and the play resolves)
  launched?: boolean
}) {
  const { t } = useTranslation()
  const verse = card.type === 'verse'
  // gentle low raise: the selected/hovered card pops just above the resting hand (title + art read
  // clearly; the lower description may sit under the bottom edge) rather than flying up the screen
  const lifted = { x: fan.x, y: 18, rotate: 0, scale: 1.06, zIndex: 50, opacity: 1 }
  const rest = { x: fan.x, y: fan.y + REST_TUCK, rotate: fan.rotate, scale: 1, zIndex: z, opacity: 1 }
  // Exit resolves through a variant so it can read AnimatePresence's `custom` flag at removal time
  // (the frozen exit snapshot can't otherwise tell a turn-end discard from a single play):
  //   • turn-end discard (custom.ending) → the whole hand just slides DOWN past the bottom edge,
  //     never flying up off the top (cf. the player's request).
  //   • a single play → aimed/launched (drag) fades (the slinging copy carries the motion);
  //     reduced motion fades; otherwise it launches toward the target (enemy) or up (self).
  const exitVariant = (custom?: { ending?: boolean }) => {
    if (custom?.ending) {
      return reduced
        ? { opacity: 0, transition: { duration: 0.12 } }
        : { opacity: 0, x: fan.x, y: fan.y + REST_TUCK + 260, rotate: fan.rotate, scale: 0.96, transition: { duration: 0.32, ease: 'easeIn' as const } }
    }
    if (aiming || launched) return { opacity: 0, scale: 0.9, transition: { duration: 0.12 } }
    if (reduced) return { opacity: 0, transition: { duration: 0.12 } }
    return {
      opacity: 0,
      x: flyTo ? flyTo.x : fan.x,
      y: flyTo ? flyTo.y : -190,
      scale: flyTo ? 0.55 : 0.7,
      rotate: 0,
      transition: { duration: flyTo ? 0.36 : 0.28 },
    }
  }
  return (
    <motion.button
      className={['card', card.layer, 'rarity-' + card.rarity, playable ? 'playable' : 'unplayable', selected ? 'selected' : '', verse ? 'verse' : '', aiming ? 'aiming' : '', launched ? 'launched' : '', peerLabel ? 'peer-eyed' : '', ownerColor ? 'owned' : ''].join(' ')}
      data-iid={card.iid}
      style={ownerColor ? ({ '--owner': ownerColor } as CSSProperties) : undefined}
      onPointerDown={onPointerDown}
      onHoverStart={() => onHover?.(true)}
      onHoverEnd={() => onHover?.(false)}
      disabled={!playable && !selected}
      initial={{ opacity: 0, x: fan.x, y: 180, rotate: fan.rotate }}
      animate={selected ? lifted : rest}
      variants={{ exit: exitVariant }}
      exit="exit"
      whileHover={playable && !selected && !aiming && !launched ? lifted : undefined}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
    >
      {peerLabel && <div className="card-peer-tag">👁 {peerLabel}</div>}
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
      <div className={'card-art ' + card.layer}>
        <span className="card-art-glyph">{cardArt(card.nameKey, card.layer)}</span>
        {ownerSymbol && <span className="owner-symbol card-owner-symbol">{ownerSymbol}</span>}
      </div>
      <div className="card-text">{t(card.textKey, card.values)}</div>
    </motion.button>
  )
}
