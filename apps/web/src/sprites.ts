// Battle combatant "sprites": a real PNG per archetype (resolved from @bible/assets), with the old
// emoji as an automatic fallback until art for that archetype is dropped in. UI-side only — the
// engine stays art-agnostic (mirrors cardArt.ts). The PNGs are static; the combat screen's existing
// transforms (lunge/hit/block/heal/idle-breathe/bob/death) animate them via the .sprite-react wrapper.

import { resolveAsset } from '@bible/assets'
import type { CombatantView } from './selectors'

/** Sprite image URL for a combatant by archetype (sprite/<archetype>), or undefined → spriteEmoji(). */
export function spriteUrl(c: CombatantView): string | undefined {
  return resolveAsset(`sprite/${c.archetype}`)
}

/** Emoji fallback (unchanged behaviour) until the PNG for an archetype is registered + present. */
export function spriteEmoji(c: CombatantView): string {
  if (c.faction === 'party') return '🧍'
  if (c.isDemon) return '👹'
  if (c.isHuman) return '🥷'
  return '🐺'
}

// A few archetypes read as larger-than-life (giants/looming spirits). Height multiplier over the
// front-row baseline; height (not transform) keeps feet planted on the ground shadow.
const SPRITE_SCALE: Record<string, number> = { goliath: 1.5, idolSpirit: 1.2, spiritOfDread: 1.15 }

/** Per-archetype size multiplier for the sprite image (1 = default). */
export function spriteScale(c: CombatantView): number {
  return SPRITE_SCALE[c.archetype] ?? 1
}
