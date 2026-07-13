// Battle combatant "sprites": a real PNG per archetype (resolved from @bible/assets), with the old
// emoji as an automatic fallback until art for that archetype is dropped in. UI-side only — the
// engine stays art-agnostic (mirrors cardArt.ts). The PNGs are static; the combat screen's existing
// transforms (lunge/hit/block/heal/idle-breathe/bob/death) animate them via the .sprite-react wrapper.

import { resolveAsset } from '@bible/assets'
import type { CombatantView } from './selectors'

// A party hero renders its CLASS sprite (Shepherd reuses the default-hero art). Non-heroes and
// classless heroes fall through to the archetype sprite. Keep in sync with @bible/assets SPRITE_FILES.
const CLASS_SPRITE: Record<string, string> = {
  zealot: 'sprite/zealot',
  shepherd: 'sprite/hero',
  merchant: 'sprite/merchant',
}

/** Sprite image URL for a combatant — the hero's class sprite when set, else sprite/<archetype>.
 *  undefined → spriteEmoji() (via the <img> onError fallback in CombatSprite). */
export function spriteUrl(c: CombatantView): string | undefined {
  const key = c.classId && CLASS_SPRITE[c.classId] ? CLASS_SPRITE[c.classId] : `sprite/${c.archetype}`
  return resolveAsset(key)
}

/** The hero portrait for a class (Shepherd = the default-hero art). undefined → caller shows an emoji.
 *  Shared by the campfire seats and the Character modal avatar. */
export function heroClassSpriteUrl(classId?: string): string | undefined {
  return resolveAsset((classId && CLASS_SPRITE[classId]) || 'sprite/hero')
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
