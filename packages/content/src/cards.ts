import type { CardDef } from '@bible/engine'

// Milestone-1 card library. Text lives in @bible/i18n by these keys; the engine sees only data.
// Flesh cards do fixed work; spirit cards (layer:'spirit') auto-scale with Spirit potency and
// FIZZLE when the player is carnal — verse cards (layer:'spirit', no floor) most of all.

export const CARDS: Record<string, CardDef> = {
  // --- flesh ---
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike.name', textKey: 'card.strike.text', rarity: 'starter', upgradeTo: 'strike_plus', effects: [{ kind: 'damage', amount: 6 }] },
  strike_heavy: { id: 'strike_heavy', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.strike_heavy.name', textKey: 'card.strike_heavy.text', rarity: 'common', effects: [{ kind: 'damage', amount: 10 }] },
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard.name', textKey: 'card.guard.text', rarity: 'starter', upgradeTo: 'guard_plus', effects: [{ kind: 'block', amount: 5 }] },
  brace: { id: 'brace', type: 'skill', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.brace.name', textKey: 'card.brace.text', rarity: 'common', effects: [{ kind: 'block', amount: 8 }] },
  second_wind: { id: 'second_wind', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.second_wind.name', textKey: 'card.second_wind.text', rarity: 'common', upgradeTo: 'second_wind_plus', effects: [{ kind: 'heal', amount: 4 }, { kind: 'draw', count: 1 }] },
  flurry: { id: 'flurry', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.flurry.name', textKey: 'card.flurry.text', rarity: 'common', upgradeTo: 'flurry_plus', effects: [{ kind: 'damage', amount: 3, hits: 2 }] },
  shove: { id: 'shove', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.shove.name', textKey: 'card.shove.text', rarity: 'common', effects: [{ kind: 'damage', amount: 4 }, { kind: 'pushRow' }] },
  quickstep: { id: 'quickstep', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.quickstep.name', textKey: 'card.quickstep.text', rarity: 'common', effects: [{ kind: 'draw', count: 2 }] },
  rally: { id: 'rally', type: 'skill', layer: 'flesh', cost: 2, target: 'allAllies', nameKey: 'card.rally.name', textKey: 'card.rally.text', rarity: 'uncommon', effects: [{ kind: 'block', amount: 3, target: 'allAllies' }] },
  subdue: { id: 'subdue', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.subdue.name', textKey: 'card.subdue.text', rarity: 'uncommon', nonLethal: true, effects: [{ kind: 'damage', amount: 8 }] },
  // maxCopies:1 — 0-cost +1 energy is classic infinite-combo fuel once draw/energy powers exist.
  focus: { id: 'focus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.focus.name', textKey: 'card.focus.text', rarity: 'uncommon', maxCopies: 1, effects: [{ kind: 'gainEnergy', amount: 1 }] },

  // --- card-manipulation skills (resolved via a "pick cards from a pile" modal in the UI) ---
  // "Iron sharpeneth iron" (Prov 27:17) — temper a chosen card into its '+' form for this battle.
  sharpen: { id: 'sharpen', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.sharpen.name', textKey: 'card.sharpen.text', descKey: 'card.sharpen.desc', rarity: 'uncommon', effects: [{ kind: 'hone', count: 1 }] },
  // "Lay aside every weight" (Heb 12:1) — banish clutter (chosen cards) to the exhaust pile. Exhausts.
  cast_off: { id: 'cast_off', type: 'skill', layer: 'flesh', cost: 1, target: 'none', exhaust: true, nameKey: 'card.cast_off.name', textKey: 'card.cast_off.text', descKey: 'card.cast_off.desc', rarity: 'uncommon', effects: [{ kind: 'exhaustChosen', count: 2 }] },
  // "Prepare ye the way" (Isa 40:3) — set a chosen card on top of the draw pile, drawn first next round.
  prepare: { id: 'prepare', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.prepare.name', textKey: 'card.prepare.text', descKey: 'card.prepare.desc', rarity: 'uncommon', effects: [{ kind: 'topDeck', count: 1 }] },

  // --- effects & buffs: enemy debuffs + poison DoT + the dexterity buff. weak/vulnerable already work
  //     in the damage pipeline; these are the first PLAYER cards to wield them. poison ticks at round
  //     resolve (stacks×scale, bypassing block) and is LETHAL. Poison cards are a TEMPTATION: each
  //     carries a hidden spiritShift toll, so a Spirit/miracle run avoids them (low Spirit dims the
  //     verse miracles) while a flesh run uses them freely. Plain, non-biblical names/text by design
  //     (only the spirit/verse cards carry scripture). ---
  venom: { id: 'venom', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.venom.name', textKey: 'card.venom.text', descKey: 'card.venom.desc', rarity: 'common', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 4 }, { kind: 'spiritShift', amount: -15, reason: 'sowedAffliction' }] },
  miasma: { id: 'miasma', type: 'skill', layer: 'flesh', cost: 2, target: 'allEnemies', nameKey: 'card.miasma.name', textKey: 'card.miasma.text', descKey: 'card.miasma.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 2, target: 'allEnemies' }, { kind: 'spiritShift', amount: -25, reason: 'sowedAffliction' }] },
  expose: { id: 'expose', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.expose.name', textKey: 'card.expose.text', descKey: 'card.expose.desc', rarity: 'common', effects: [{ kind: 'applyStatus', status: 'vulnerable', stacks: 2 }] },
  cripple: { id: 'cripple', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.cripple.name', textKey: 'card.cripple.text', descKey: 'card.cripple.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'weak', stacks: 2 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1 }] },
  shackle: { id: 'shackle', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.shackle.name', textKey: 'card.shackle.text', descKey: 'card.shackle.desc', rarity: 'rare', maxCopies: 1, effects: [{ kind: 'applyStatus', status: 'bound', stacks: 1 }] },
  sure_hands: { id: 'sure_hands', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.sure_hands.name', textKey: 'card.sure_hands.text', descKey: 'card.sure_hands.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },

  // --- enemy-injected clutter (never owned/bought): a "thorn" that only clogs the deck (Matt 13:22).
  //     Unplayable; cleared only by an `exhaustChosen` card (Cast Off). ---
  spike: { id: 'spike', type: 'status', layer: 'flesh', cost: 0, target: 'none', unplayable: true, nameKey: 'card.spike.name', textKey: 'card.spike.text', descKey: 'card.spike.desc', effects: [] },

  // --- MIRACLE cards: earned ONLY by solving scripture (study at a fireplace → ownedVerseCardIds →
  //     persistent across runs). All `layer:'spirit'`: chance + magnitude scale with the hidden Spirit
  //     stat, and they fizzle when carnal. They are never in the pool/starter deck. ---
  // "Not by might, nor by power, but by my Spirit" — God removes a foe from the field.
  verse_zech_4_6: { id: 'verse_zech_4_6', type: 'verse', layer: 'spirit', cost: 2, target: 'none', exhaust: true, nameKey: 'card.verse_zech_4_6.name', textKey: 'card.verse_zech_4_6.text', descKey: 'card.verse_zech_4_6.desc', rarity: 'rare', fruitAffinity: 'faith', verseChallengeId: 'zech_4_6', effects: [{ kind: 'banish', floor: 0.1, cap: 0.85 }] },
  // "The peace of God shall guard your hearts" — a shield that may turn deadly blows into a scratch.
  verse_phil_4_6: { id: 'verse_phil_4_6', type: 'verse', layer: 'spirit', cost: 1, target: 'allAllies', nameKey: 'card.verse_phil_4_6.name', textKey: 'card.verse_phil_4_6.text', descKey: 'card.verse_phil_4_6.desc', rarity: 'rare', fruitAffinity: 'faith', verseChallengeId: 'phil_4_6', effects: [{ kind: 'protect', turns: 2, floor: 0.15, cap: 0.9, target: 'allAllies' }] },
  // "Love thy neighbour" — mercy poured out heals the whole company (scales with Spirit).
  verse_luke_10_27: { id: 'verse_luke_10_27', type: 'verse', layer: 'spirit', cost: 1, target: 'allAllies', nameKey: 'card.verse_luke_10_27.name', textKey: 'card.verse_luke_10_27.text', descKey: 'card.verse_luke_10_27.desc', rarity: 'rare', fruitAffinity: 'mercy', verseChallengeId: 'luke_10_27', effects: [{ kind: 'heal', amount: 8, target: 'allAllies' }] },
  // "Open his eyes, that he may see" — applied to a foe, reveals the demon bound behind it (replaces
  // the old Sight grace button). A plain card: a dead draw when no demon hides — a deckbuilding choice.
  verse_2kings_6_17: { id: 'verse_2kings_6_17', type: 'verse', layer: 'spirit', cost: 1, target: 'enemy', nameKey: 'card.verse_2kings_6_17.name', textKey: 'card.verse_2kings_6_17.text', descKey: 'card.verse_2kings_6_17.desc', rarity: 'rare', fruitAffinity: 'knowledge', verseChallengeId: '2kings_6_17', effects: [{ kind: 'revealHidden', via: 'sight' }] },

  // --- '+' upgrade variants (created by upgrading at a fire; never offered in the pool) ---
  strike_plus: { id: 'strike_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike_plus.name', textKey: 'card.strike_plus.text', rarity: 'starter', effects: [{ kind: 'damage', amount: 9 }] },
  guard_plus: { id: 'guard_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard_plus.name', textKey: 'card.guard_plus.text', rarity: 'starter', effects: [{ kind: 'block', amount: 8 }] },
  second_wind_plus: { id: 'second_wind_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.second_wind_plus.name', textKey: 'card.second_wind_plus.text', rarity: 'common', effects: [{ kind: 'heal', amount: 6 }, { kind: 'draw', count: 1 }] },
  flurry_plus: { id: 'flurry_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.flurry_plus.name', textKey: 'card.flurry_plus.text', rarity: 'common', effects: [{ kind: 'damage', amount: 3, hits: 3 }] },

  // --- pool cards unlocked by hero level (see cardUnlocksByLevel in index.ts) ---
  riposte: { id: 'riposte', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.riposte.name', textKey: 'card.riposte.text', rarity: 'common', effects: [{ kind: 'block', amount: 5 }, { kind: 'damage', amount: 5 }] },
  exhort: { id: 'exhort', type: 'skill', layer: 'flesh', cost: 1, target: 'allAllies', nameKey: 'card.exhort.name', textKey: 'card.exhort.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'allAllies' }] },
  // Steadfast is now a TRUE persistent power: 4 Block now + a power granting +1 Strength every round.
  steadfast: { id: 'steadfast', type: 'power', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.steadfast.name', textKey: 'card.steadfast.text', descKey: 'card.steadfast.desc', rarity: 'uncommon', effects: [{ kind: 'block', amount: 4 }, { kind: 'gainPower', power: 'steadfast', stacks: 1 }] },

  // --- persistent powers. Each installs a power that reacts every round / on card-play / in the damage
  //     pipeline (see combat/powers.ts). Replaying a power stacks it; the draw/energy powers
  //     (momentum, adrenaline) are maxCopies:1 to keep their payoff bounded.
  //     (IDs keep their old armour-set names internally; display names are plain — see i18n.) ---
  menace: { id: 'menace', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.menace.name', textKey: 'card.menace.text', descKey: 'card.menace.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'menace', stacks: 1 }] },
  bulwark: { id: 'bulwark', type: 'power', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.bulwark.name', textKey: 'card.bulwark.text', descKey: 'card.bulwark.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'bulwark', stacks: 3 }] },
  bastion: { id: 'bastion', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.bastion.name', textKey: 'card.bastion.text', descKey: 'card.bastion.desc', rarity: 'rare', effects: [{ kind: 'gainPower', power: 'bastion', stacks: 4 }] },
  momentum: { id: 'momentum', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.momentum.name', textKey: 'card.momentum.text', descKey: 'card.momentum.desc', rarity: 'uncommon', maxCopies: 1, effects: [{ kind: 'gainPower', power: 'momentum', stacks: 1 }] },
  whetstone: { id: 'whetstone', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.whetstone.name', textKey: 'card.whetstone.text', descKey: 'card.whetstone.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'whetstone', stacks: 2 }] },
  adrenaline: { id: 'adrenaline', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.adrenaline.name', textKey: 'card.adrenaline.text', descKey: 'card.adrenaline.desc', rarity: 'common', maxCopies: 1, effects: [{ kind: 'gainPower', power: 'adrenaline', stacks: 1 }] },
  fury: { id: 'fury', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.fury.name', textKey: 'card.fury.text', descKey: 'card.fury.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'fury', stacks: 1 }] },
  // Temperance is an INSTANT party buff (not a power): immediate Strength + Block to all allies.
  embolden: { id: 'embolden', type: 'skill', layer: 'flesh', cost: 1, target: 'allAllies', nameKey: 'card.embolden.name', textKey: 'card.embolden.text', descKey: 'card.embolden.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'allAllies' }, { kind: 'block', amount: 3, target: 'allAllies' }] },

  // --- scaling payoffs: attacks/blocks that grow with an accumulated metric (the engine payoffs) ---
  // Converts stacked Poison into burst WITHOUT consuming it (the rot keeps ticking).
  rupture: { id: 'rupture', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.rupture.name', textKey: 'card.rupture.text', descKey: 'card.rupture.desc', rarity: 'uncommon', effects: [{ kind: 'damageScaling', per: 'poisonOnTarget', amount: 4, coeff: 1 }] },
  // Deals damage equal to your Block (non-consuming, coeff-capped) — the turtle payoff. Rare.
  shield_bash: { id: 'shield_bash', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.shield_bash.name', textKey: 'card.shield_bash.text', descKey: 'card.shield_bash.desc', rarity: 'rare', effects: [{ kind: 'damageScaling', per: 'block', amount: 0, coeff: 1 }] },
  // Rewards being played LATE in a turn (after other cards) — bridges block + play-many tempo.
  shield_wall: { id: 'shield_wall', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.shield_wall.name', textKey: 'card.shield_wall.text', descKey: 'card.shield_wall.desc', rarity: 'common', effects: [{ kind: 'blockScaling', per: 'cardsPlayedThisTurn', amount: 3, coeff: 2, target: 'self' }] },
  // Finisher: an execute that doubles against a near-dead foe.
  deathblow: { id: 'deathblow', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.deathblow.name', textKey: 'card.deathblow.text', descKey: 'card.deathblow.desc', rarity: 'uncommon', effects: [{ kind: 'execute', amount: 12, bonus: 12, below: 0.2 }] },
  // 0-cost cantrip: replaces itself and advances the card-count engines (Helmet / Shield Wall). maxCopies:1.
  foresight: { id: 'foresight', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.foresight.name', textKey: 'card.foresight.text', descKey: 'card.foresight.desc', rarity: 'common', maxCopies: 1, effects: [{ kind: 'draw', count: 1 }] },
}

/** Cards available to draw/buy from the pool at level 1 (the existing non-starter library). */
export const CARD_POOL_START: string[] = [
  'strike_heavy',
  'brace',
  'quickstep',
  'shove',
  'rally',
  'focus',
  // card-manipulation skills — offered in rewards/shops
  'sharpen',
  'cast_off',
  'prepare',
  // effects & buffs — the first player debuff/DoT/buff cards (the rest unlock by level)
  'venom',
  'expose',
  'sure_hands',
  // persistent powers — the engine cards (heavier powers unlock by level)
  'menace',
  'whetstone',
  'adrenaline',
  'embolden',
  // scaling payoffs
  'rupture',
  'shield_wall',
  'foresight',
  'deathblow',
]

/** Cards added to the hero's pool upon reaching each level. Spirit cards are NOT here — they are
 *  earned only by solving scripture (study at a fireplace) and persist via ownedVerseCardIds. */
export const CARD_UNLOCKS_BY_LEVEL: Record<number, string[]> = {
  2: ['riposte', 'miasma'],
  3: ['exhort', 'cripple', 'momentum'],
  4: ['shackle', 'bulwark'],
  5: ['steadfast', 'fury'],
  6: ['bastion'],
  7: ['shield_bash'],
}

/** Max run-deck size; reward/shop adds are blocked at the cap. */
export const DECK_LIMIT = 20

export const HERO_START_DECK: string[] = [
  'strike',
  'strike',
  'strike',
  'guard',
  'guard',
  'subdue', // mercy is possible from the very first robber fight
  'second_wind',
  'flurry',
  // card-manipulation skills — seeded into the starter deck so the new modals are immediately
  // playable/testable. (Easily removed: these are also in CARD_POOL_START for normal acquisition.)
  'sharpen',
  'cast_off',
  'prepare',
  // New buff/effect/power cards are NOT seeded — they are earned through deckbuilding (rewards / shops /
  // level unlocks), like every other pool card.
  // No spirit cards by default — miracle cards are earned by solving scripture (study at a fireplace).
]
