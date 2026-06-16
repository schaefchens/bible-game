import type { AssetRef, CardDefId, I18nKey, MemberId } from '../types'

/** A card's nature. `flesh` cards do fixed work scaled by LEVEL; `spirit` cards are miracles whose
 *  numeric magnitude AND chance scale with the hidden Spirit resource (and fizzle when carnal). */
export type CardLayer = 'flesh' | 'spirit'
export type CardType = 'attack' | 'skill' | 'power' | 'spiritual' | 'verse' | 'status' | 'curse'

export type TargetKind = 'enemy' | 'allEnemies' | 'ally' | 'self' | 'allAllies' | 'none'

/** Milestone-1 status library (kept small and composable). 'lastStand' is a reusable "rally" buff:
 *  while held, the combatant deals ×2 damage and takes ×½ (see damage.ts physicalAmount). Any trigger
 *  can grant it; today the sole-surviving-foe trigger does (combat.ts refreshLastStand). */
export type StatusId = 'weak' | 'vulnerable' | 'strength' | 'bound' | 'lastStand'

export type FruitAffinity = 'mercy' | 'faith' | 'knowledge'

/**
 * Data-driven, serializable card effect language resolved by the interpreter (combat/applyEffect).
 * There is ONE damage type (flesh HP damage, mitigated only by block). A card's `layer:'spirit'`
 * makes its numeric ops scale by Spirit potency; flesh ops scale by the attacker's level.
 * Miracle ops (`banish`, `protect`) roll a Spirit-scaled chance (`miracleChance`).
 */
export type EffectOp =
  | { kind: 'damage'; amount: number; target?: TargetKind; hits?: number }
  | { kind: 'block'; amount: number; target?: TargetKind }
  | { kind: 'heal'; amount: number; target?: TargetKind }
  | { kind: 'applyStatus'; status: StatusId; stacks: number; target?: TargetKind }
  | { kind: 'draw'; count: number }
  | { kind: 'gainEnergy'; amount: number }
  /** push the target to the back row (e.g. "shove") */
  | { kind: 'pushRow'; target?: TargetKind }
  | { kind: 'spiritShift'; amount: number; reason: string }
  | { kind: 'revealHidden'; via: 'sight' }
  /** MIRACLE: chance (Spirit-scaled, floor→cap) to remove a random non-`banishImmune` enemy from battle */
  | { kind: 'banish'; floor: number; cap: number }
  /** MIRACLE: grant the target a `shield` for `turns` — each incoming hit has a Spirit-scaled chance to be reduced to 1 */
  | { kind: 'protect'; turns: number; floor: number; cap: number; target?: TargetKind }
  /** CARD-TARGET: temporarily upgrade up to `count` chosen cards (→ their `upgradeTo` form) for the
   *  rest of this battle. The UI supplies the chosen card iids; only cards with a `+` form qualify. */
  | { kind: 'hone'; count: number }
  /** CARD-TARGET: banish up to `count` chosen cards to the exhaust pile for the rest of the battle
   *  (the counter to enemy-injected clutter). The UI supplies the chosen card iids. */
  | { kind: 'exhaustChosen'; count: number }
  /** CARD-TARGET: place up to `count` chosen cards on TOP of the draw pile (drawn first next round).
   *  The UI supplies the chosen card iids. */
  | { kind: 'topDeck'; count: number }

export interface CardDef {
  id: CardDefId
  type: CardType
  layer: CardLayer
  cost: number
  target: TargetKind
  effects: EffectOp[]
  nameKey: I18nKey
  textKey: I18nKey
  art?: AssetRef
  rarity?: 'starter' | 'common' | 'uncommon' | 'rare'
  exhaust?: boolean
  /** clutter cards (e.g. enemy-injected Spike) that can NEVER be played — they only clog the piles
   *  until banished (e.g. by an `exhaustChosen` card). Rendered greyed/unplayable in hand. */
  unplayable?: boolean
  /** non-lethal against human targets (Mercy / subdue) — can reduce to 1 HP but never kill */
  nonLethal?: boolean
  /** verse cards are latent until earned via gap-fill (verseChallengeId references the challenge) */
  verseChallengeId?: string
  fruitAffinity?: FruitAffinity
  /** the fixed '+' form this card upgrades into at a fireplace (an ephemeral run-deck slot swap). The
   *  '+' CardDef is a normal entry in the card registry but is never placed in the pool / sampled. */
  upgradeTo?: CardDefId
  /** max copies of this card allowed in one run deck. Default (see cards/pool.maxCopiesOf): 1 for
   *  spirit-layer cards (so a miracle like Finger of God can never stack), unlimited for flesh.
   *  Enforced at every deck add-path (reward / shop / event grant / fragment-study). */
  maxCopies?: number
}

/** A physical copy of a card within a single combat. */
export interface CardInstance {
  iid: string
  defId: CardDefId
  /** the party member who contributed this card — KEY for clean death-purge from all piles */
  ownerId: MemberId
  costOverride?: number
  /** set by a `hone` effect: while present, this copy resolves to (and plays/displays as) this def
   *  for the rest of the battle — its `defId`'s `upgradeTo` form. Travels with the instance. */
  honedDefId?: CardDefId
}
