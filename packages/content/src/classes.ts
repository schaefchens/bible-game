import type { ClassId, HeroClassKit } from '@bible/engine'

// Per-class run-start kits: each class's OWN starter deck (built from the shared card library + its one
// signature card) plus its grace abilities. The stat block + passive perk half lives in the engine class
// table (state/heroClasses.ts); this is the content half. A class absent here falls back to the bundle's
// default heroStartDeck/heroGraceAbilities (see buildRunHero).
//
// Decks are ~10 cards, tuned to the playstyle:
//   Zealot   — offense-heavy, thin defense (4× Strike + Wrath + Flurry; one Guard).
//   Shepherd — durable + sustain (3× Guard + Shepherd's Staff; two heals).
//   Merchant — balanced with card flow (Barter turns the deck over).
export const HERO_CLASS_KITS: Record<ClassId, HeroClassKit> = {
  zealot: {
    startDeck: ['strike', 'strike', 'strike', 'strike', 'guard', 'subdue', 'flurry', 'wrath', 'second_wind', 'sharpen'],
    graceAbilityIds: ['mercy'],
  },
  shepherd: {
    startDeck: ['strike', 'strike', 'guard', 'guard', 'guard', 'subdue', 'second_wind', 'shepherds_staff', 'cast_off', 'prepare'],
    graceAbilityIds: ['mercy'],
  },
  merchant: {
    startDeck: ['strike', 'strike', 'strike', 'guard', 'guard', 'subdue', 'second_wind', 'barter', 'cast_off', 'prepare'],
    graceAbilityIds: ['mercy'],
  },
}
