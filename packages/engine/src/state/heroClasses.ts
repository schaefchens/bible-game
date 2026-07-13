// Hero classes — the three playstyles a pilgrim is created as at the fire (Zealot / Shepherd / Merchant).
// A class is not just a stat block: each carries a PASSIVE PERK that changes how the run plays, and (via
// content) its own starter deck + signature card. The stat + perk half lives HERE in the engine (game
// rules, read at creation + combat + reward time); the deck/grace half lives in content (heroClassKits),
// since it references authored card ids.
//
// Base stats DERIVE from the classId (single source of truth) — see character.ts accessors. A Character
// with NO classId (engine test fixtures) falls back to the neutral baseline (HP_UNIT / power 1 / default
// gold); persisted saves written before classes existed default to 'shepherd' on load (see schema.ts).

export type ClassId = 'zealot' | 'shepherd' | 'merchant'

export const CLASS_IDS: ClassId[] = ['zealot', 'shepherd', 'merchant']

/** The class assigned to heroes created before classes existed (legacy saves) — the durable Shepherd. */
export const DEFAULT_CLASS_ID: ClassId = 'shepherd'

/** Passive perks a class grants. All optional — a class sets only the ones it uses. Read by combat
 *  (startCombatStrength → encounterBuilder), reward writeback (postBattleHealPct), and gold claims
 *  (rewardGoldPct). Undefined class → no perks (see classPerks). */
export interface ClassPerks {
  /** Zeal: begin every combat with this many Strength stacks (flat bonus damage, scales with level). */
  startCombatStrength?: number
  /** Green Pastures: heal this FRACTION of max HP after every won battle (0.1 = 10%). */
  postBattleHealPct?: number
  /** Shrewd Trade: multiply gold from battle rewards by (1 + this) (0.5 = +50%). */
  rewardGoldPct?: number
}

export interface HeroClassDef {
  id: ClassId
  /** base HP in level-1 units (scaled by hpScale); the neutral hero is HP_UNIT = 50. */
  baseHp: number
  /** flesh-damage multiplier applied on top of the level curve (1 = neutral). */
  power: number
  /** starting purse (co-op pools every member's). */
  startGold: number
  perks: ClassPerks
}

// Zealot leans on Zeal (+2 Strength ≈ a steady ~+20% on a basic Strike at every level) as its damage
// identity, so `power` stays only mildly above neutral (1.15) rather than double-dipping a big multiplier
// on top. Fragile (40 HP). Shepherd trades offense for durability + between-fight sustain. Merchant is a
// neutral fighter that starts rich and earns 50% more gold.
export const HERO_CLASSES: Record<ClassId, HeroClassDef> = {
  zealot: { id: 'zealot', baseHp: 40, power: 1.15, startGold: 70, perks: { startCombatStrength: 2 } },
  shepherd: { id: 'shepherd', baseHp: 80, power: 0.85, startGold: 50, perks: { postBattleHealPct: 0.1 } },
  merchant: { id: 'merchant', baseHp: 50, power: 1.0, startGold: 150, perks: { rewardGoldPct: 0.5 } },
}

/** The class definition for an id (defaults to the legacy Shepherd for an unknown id). */
export const heroClassDef = (id: ClassId): HeroClassDef => HERO_CLASSES[id] ?? HERO_CLASSES[DEFAULT_CLASS_ID]

/** Perks for a class id — an empty set when the member has no class (neutral test hero). */
export const classPerks = (id: ClassId | undefined): ClassPerks => (id ? heroClassDef(id).perks : {})
