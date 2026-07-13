// Maps combat outcomes → SFX keys (registered in @bible/assets). Variant choice uses Math.random,
// which is fine HERE (the UI/feedback layer) — never in the deterministic engine. Keys resolve to the
// files copied into apps/web/public/assets/ (see the asset REGISTRY).

const STRIKE_POOL = ['sfx/strike-1', 'sfx/strike-2', 'sfx/strike-3', 'sfx/strike-4', 'sfx/strike-5', 'sfx/strike-6', 'sfx/strike-7'] as const
const BLOCK_POOL = ['sfx/block-1', 'sfx/block-2'] as const
const SPIRIT_DEATH_POOL = ['sfx/death-spirit', 'sfx/death-spirit-2'] as const

/** Every combat SFX key — preloaded (decoded) when the combat screen mounts so the first hit is instant. */
export const ALL_COMBAT_SFX: string[] = [
  ...STRIKE_POOL,
  'sfx/strike-goliath',
  'sfx/strike-arrow',
  ...BLOCK_POOL,
  'sfx/death-human',
  ...SPIRIT_DEATH_POOL,
  'sfx/death-monster',
  'sfx/death-goliath',
  'sfx/incapacitate',
  'sfx/battle-won',
  'sfx/battle-lost',
]

const pick = <T>(pool: readonly T[]): T => pool[Math.floor(Math.random() * pool.length)]!

// "Wind-up" sounds are loosed at the start of the attack (the bow release), not on impact — so the
// arrow is heard flying before it lands. Melee thuds and death cries play on impact.
const WINDUP_SOUNDS = new Set<string>(['sfx/strike-arrow'])
export function isWindupSound(key: string): boolean {
  return WINDUP_SOUNDS.has(key)
}

// The arrow clip is a full whoosh→impact→ring (~1.15s) with its IMPACT at ~0.8s (then a fading tail) —
// far longer than the lunge→impact beat (~160ms). Play only the TAIL starting ~0.15s BEFORE that impact
// (offsetFromEnd ≈ duration − 0.6s) at the wind-up, so you hear the incoming whoosh and the impact lands
// ON the visual hit. (A smaller value lands in the dead decay tail → no audible hit.) Tune to taste.
const PLAY_OPTS: Record<string, { gain?: number; offsetFromEnd?: number }> = {
  'sfx/strike-arrow': { offsetFromEnd: 0.55 },
  'sfx/strike-goliath': { gain: 0.25 }, // the giant's bash clip is hot — pull it down so it doesn't peak
}
export function sfxOpts(key: string): { gain?: number; offsetFromEnd?: number } | undefined {
  return PLAY_OPTS[key]
}

/** What's needed to choose a death sound — a structural subset of a Combatant (no engine import). */
export interface SfxVictim {
  archetype: string
  isHuman: boolean
  isDemon?: boolean
}

/** A blow landing — keyed to the attacker where we know it (the giant, an archer), else a random punch. */
export function strikeSound(attackerArchetype?: string): string {
  if (attackerArchetype === 'goliath') return 'sfx/strike-goliath'
  if (attackerArchetype === 'philistineArcher') return 'sfx/strike-arrow'
  return pick(STRIKE_POOL)
}

/** A blow absorbed by Block — a shield clang. */
export function blockSound(): string {
  return pick(BLOCK_POOL)
}

/** A combatant killed — distinct cries for the giant, demons/spirits, humans, and other foes. */
export function deathSound(victim: SfxVictim | undefined): string {
  if (!victim) return 'sfx/death-human'
  if (victim.archetype === 'goliath') return 'sfx/death-goliath'
  if (victim.isDemon) return pick(SPIRIT_DEATH_POOL)
  if (victim.isHuman) return 'sfx/death-human'
  return 'sfx/death-monster'
}

/** A human subdued/spared (non-lethal) rather than killed. */
export function incapacitateSound(): string {
  return 'sfx/incapacitate'
}
