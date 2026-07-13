import type { CardDef } from '@bible/engine'

// Milestone-1 card library. Text lives in @bible/i18n by these keys; the engine sees only data.
// Flesh cards do fixed work; spirit cards (layer:'spirit') auto-scale with Spirit potency and
// FIZZLE when the player is carnal — verse cards (layer:'spirit', no floor) most of all.

export const CARDS: Record<string, CardDef> = {
  // --- flesh ---
  strike: { id: 'strike', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike.name', textKey: 'card.strike.text', rarity: 'starter', upgradeTo: 'strike_plus', effects: [{ kind: 'damage', amount: 6 }] },
  strike_heavy: { id: 'strike_heavy', upgradeTo: 'strike_heavy_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.strike_heavy.name', textKey: 'card.strike_heavy.text', rarity: 'common', effects: [{ kind: 'damage', amount: 10 }] },
  guard: { id: 'guard', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard.name', textKey: 'card.guard.text', rarity: 'starter', upgradeTo: 'guard_plus', effects: [{ kind: 'block', amount: 5 }] },
  brace: { id: 'brace', upgradeTo: 'brace_plus', type: 'skill', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.brace.name', textKey: 'card.brace.text', rarity: 'common', effects: [{ kind: 'block', amount: 8 }] },
  // Co-op support: heals a CHOSEN party member (aim it at a hurt teammate); solo it heals the hero. The
  // draw is faction-agnostic (feeds the shared pile). target:'ally' → picks a party member (else self).
  second_wind: { id: 'second_wind', type: 'skill', layer: 'flesh', cost: 1, target: 'ally', nameKey: 'card.second_wind.name', textKey: 'card.second_wind.text', rarity: 'common', upgradeTo: 'second_wind_plus', effects: [{ kind: 'heal', amount: 4, target: 'ally' }, { kind: 'draw', count: 1 }] },
  flurry: { id: 'flurry', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.flurry.name', textKey: 'card.flurry.text', rarity: 'common', upgradeTo: 'flurry_plus', effects: [{ kind: 'damage', amount: 3, hits: 2 }] },
  shove: { id: 'shove', upgradeTo: 'shove_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.shove.name', textKey: 'card.shove.text', rarity: 'common', effects: [{ kind: 'damage', amount: 4 }, { kind: 'pushRow' }] },
  quickstep: { id: 'quickstep', upgradeTo: 'quickstep_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.quickstep.name', textKey: 'card.quickstep.text', rarity: 'common', effects: [{ kind: 'draw', count: 2 }] },
  rally: { id: 'rally', upgradeTo: 'rally_plus', type: 'skill', layer: 'flesh', cost: 2, target: 'allAllies', nameKey: 'card.rally.name', textKey: 'card.rally.text', rarity: 'uncommon', effects: [{ kind: 'block', amount: 3, target: 'allAllies' }] },
  subdue: { id: 'subdue', upgradeTo: 'subdue_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.subdue.name', textKey: 'card.subdue.text', rarity: 'uncommon', nonLethal: true, effects: [{ kind: 'damage', amount: 8 }] },
  // maxCopies:1 — 0-cost +1 energy is classic infinite-combo fuel once draw/energy powers exist.
  focus: { id: 'focus', upgradeTo: 'focus_plus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.focus.name', textKey: 'card.focus.text', rarity: 'uncommon', maxCopies: 1, effects: [{ kind: 'gainEnergy', amount: 1 }] },

  // --- class signature cards (seeded ONLY into their class's starter deck; rarity:'starter' keeps them
  //     out of the reward/shop pool). One per class — the flavour anchor of each playstyle. ---
  wrath: { id: 'wrath', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.wrath.name', textKey: 'card.wrath.text', rarity: 'starter', effects: [{ kind: 'damage', amount: 14 }] }, // Zealot: a heavy, zealous blow
  shepherds_staff: { id: 'shepherds_staff', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.shepherds_staff.name', textKey: 'card.shepherds_staff.text', rarity: 'starter', effects: [{ kind: 'block', amount: 6 }, { kind: 'heal', amount: 3, target: 'self' }] }, // Shepherd: guard + tend
  barter: { id: 'barter', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.barter.name', textKey: 'card.barter.text', rarity: 'starter', effects: [{ kind: 'draw', count: 2 }] }, // Merchant: turn the deck over

  // --- card-manipulation skills (resolved via a "pick cards from a pile" modal in the UI) ---
  // "Iron sharpeneth iron" (Prov 27:17) — temper a chosen card into its '+' form for this battle.
  sharpen: { id: 'sharpen', upgradeTo: 'sharpen_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.sharpen.name', textKey: 'card.sharpen.text', descKey: 'card.sharpen.desc', rarity: 'uncommon', effects: [{ kind: 'hone', count: 1 }] },
  // "Lay aside every weight" (Heb 12:1) — banish clutter (chosen cards) to the exhaust pile. Exhausts.
  cast_off: { id: 'cast_off', upgradeTo: 'cast_off_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'none', exhaust: true, nameKey: 'card.cast_off.name', textKey: 'card.cast_off.text', descKey: 'card.cast_off.desc', rarity: 'uncommon', effects: [{ kind: 'exhaustChosen', count: 2 }] },
  // "Prepare ye the way" (Isa 40:3) — set a chosen card on top of the draw pile, drawn first next round.
  prepare: { id: 'prepare', upgradeTo: 'prepare_plus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.prepare.name', textKey: 'card.prepare.text', descKey: 'card.prepare.desc', rarity: 'uncommon', effects: [{ kind: 'topDeck', count: 1 }] },

  // --- effects & buffs: enemy debuffs + poison DoT + the dexterity buff. weak/vulnerable already work
  //     in the damage pipeline; these are the first PLAYER cards to wield them. poison ticks at round
  //     resolve (stacks×scale, bypassing block) and is LETHAL. Poison cards are a TEMPTATION: each
  //     carries a hidden spiritShift toll, so a Spirit/miracle run avoids them (low Spirit dims the
  //     verse miracles) while a flesh run uses them freely. Plain, non-biblical names/text by design
  //     (only the spirit/verse cards carry scripture). ---
  venom: { id: 'venom', upgradeTo: 'venom_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.venom.name', textKey: 'card.venom.text', descKey: 'card.venom.desc', rarity: 'common', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 4 }, { kind: 'spiritShift', amount: -15, reason: 'sowedAffliction' }] },
  miasma: { id: 'miasma', upgradeTo: 'miasma_plus', type: 'skill', layer: 'flesh', cost: 2, target: 'allEnemies', nameKey: 'card.miasma.name', textKey: 'card.miasma.text', descKey: 'card.miasma.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 2, target: 'allEnemies' }, { kind: 'spiritShift', amount: -25, reason: 'sowedAffliction' }] },
  expose: { id: 'expose', upgradeTo: 'expose_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.expose.name', textKey: 'card.expose.text', descKey: 'card.expose.desc', rarity: 'common', effects: [{ kind: 'applyStatus', status: 'vulnerable', stacks: 2 }] },
  cripple: { id: 'cripple', upgradeTo: 'cripple_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.cripple.name', textKey: 'card.cripple.text', descKey: 'card.cripple.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'weak', stacks: 2 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1 }] },
  shackle: { id: 'shackle', upgradeTo: 'shackle_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.shackle.name', textKey: 'card.shackle.text', descKey: 'card.shackle.desc', rarity: 'rare', maxCopies: 1, effects: [{ kind: 'applyStatus', status: 'bound', stacks: 1 }] },
  sure_hands: { id: 'sure_hands', upgradeTo: 'sure_hands_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.sure_hands.name', textKey: 'card.sure_hands.text', descKey: 'card.sure_hands.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 1, target: 'self' }] },

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
  strike_plus: { id: 'strike_plus', upgradeTo: 'strike_plus_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike_plus.name', textKey: 'card.strike_plus.text', rarity: 'starter', effects: [{ kind: 'damage', amount: 9 }] },
  guard_plus: { id: 'guard_plus', upgradeTo: 'guard_plus_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard_plus.name', textKey: 'card.guard_plus.text', rarity: 'starter', effects: [{ kind: 'block', amount: 8 }] },
  // multi-level (++ / +++) chains for the core cards. +++ is transformative (adds a new effect), not
  // just a bigger number — showcasing that each upgrade level is a full, independent card.
  strike_plus_plus: { id: 'strike_plus_plus', upgradeTo: 'strike_plus_plus_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike_plus_plus.name', textKey: 'card.strike_plus_plus.text', rarity: 'starter', effects: [{ kind: 'damage', amount: 12 }] },
  strike_plus_plus_plus: { id: 'strike_plus_plus_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.strike_plus_plus_plus.name', textKey: 'card.strike_plus_plus_plus.text', rarity: 'starter', effects: [{ kind: 'damage', amount: 15 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 1 }] },
  guard_plus_plus: { id: 'guard_plus_plus', upgradeTo: 'guard_plus_plus_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard_plus_plus.name', textKey: 'card.guard_plus_plus.text', rarity: 'starter', effects: [{ kind: 'block', amount: 11 }] },
  guard_plus_plus_plus: { id: 'guard_plus_plus_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.guard_plus_plus_plus.name', textKey: 'card.guard_plus_plus_plus.text', rarity: 'starter', effects: [{ kind: 'block', amount: 13 }, { kind: 'draw', count: 1 }] },
  subdue_plus_plus: { id: 'subdue_plus_plus', upgradeTo: 'subdue_plus_plus_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.subdue_plus_plus.name', textKey: 'card.subdue_plus_plus.text', rarity: 'uncommon', nonLethal: true, effects: [{ kind: 'damage', amount: 16 }] },
  subdue_plus_plus_plus: { id: 'subdue_plus_plus_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.subdue_plus_plus_plus.name', textKey: 'card.subdue_plus_plus_plus.text', rarity: 'uncommon', nonLethal: true, effects: [{ kind: 'damage', amount: 18 }, { kind: 'applyStatus', status: 'weak', stacks: 2 }] },
  second_wind_plus: { id: 'second_wind_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'ally', nameKey: 'card.second_wind_plus.name', textKey: 'card.second_wind_plus.text', rarity: 'common', effects: [{ kind: 'heal', amount: 6, target: 'ally' }, { kind: 'draw', count: 1 }] },
  flurry_plus: { id: 'flurry_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.flurry_plus.name', textKey: 'card.flurry_plus.text', rarity: 'common', effects: [{ kind: 'damage', amount: 3, hits: 3 }] },

  // --- pool cards unlocked by hero level (see cardUnlocksByLevel in index.ts) ---
  riposte: { id: 'riposte', upgradeTo: 'riposte_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.riposte.name', textKey: 'card.riposte.text', rarity: 'common', effects: [{ kind: 'block', amount: 5 }, { kind: 'damage', amount: 5 }] },
  exhort: { id: 'exhort', upgradeTo: 'exhort_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'allAllies', nameKey: 'card.exhort.name', textKey: 'card.exhort.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'allAllies' }] },
  // Steadfast is now a TRUE persistent power: 4 Block now + a power granting +1 Strength every round.
  steadfast: { id: 'steadfast', upgradeTo: 'steadfast_plus', type: 'power', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.steadfast.name', textKey: 'card.steadfast.text', descKey: 'card.steadfast.desc', rarity: 'uncommon', effects: [{ kind: 'block', amount: 4 }, { kind: 'gainPower', power: 'steadfast', stacks: 1 }] },

  // --- persistent powers. Each installs a power that reacts every round / on card-play / in the damage
  //     pipeline (see combat/powers.ts). Replaying a power stacks it; the draw/energy powers
  //     (momentum, adrenaline) are maxCopies:1 to keep their payoff bounded.
  //     (IDs keep their old armour-set names internally; display names are plain — see i18n.) ---
  menace: { id: 'menace', upgradeTo: 'menace_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.menace.name', textKey: 'card.menace.text', descKey: 'card.menace.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'menace', stacks: 1 }] },
  bulwark: { id: 'bulwark', upgradeTo: 'bulwark_plus', type: 'power', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.bulwark.name', textKey: 'card.bulwark.text', descKey: 'card.bulwark.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'bulwark', stacks: 3 }] },
  bastion: { id: 'bastion', upgradeTo: 'bastion_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.bastion.name', textKey: 'card.bastion.text', descKey: 'card.bastion.desc', rarity: 'rare', effects: [{ kind: 'gainPower', power: 'bastion', stacks: 4 }] },
  momentum: { id: 'momentum', upgradeTo: 'momentum_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.momentum.name', textKey: 'card.momentum.text', descKey: 'card.momentum.desc', rarity: 'uncommon', maxCopies: 1, effects: [{ kind: 'gainPower', power: 'momentum', stacks: 1 }] },
  whetstone: { id: 'whetstone', upgradeTo: 'whetstone_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.whetstone.name', textKey: 'card.whetstone.text', descKey: 'card.whetstone.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'whetstone', stacks: 2 }] },
  adrenaline: { id: 'adrenaline', upgradeTo: 'adrenaline_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.adrenaline.name', textKey: 'card.adrenaline.text', descKey: 'card.adrenaline.desc', rarity: 'common', maxCopies: 1, effects: [{ kind: 'gainPower', power: 'adrenaline', stacks: 1 }] },
  fury: { id: 'fury', upgradeTo: 'fury_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.fury.name', textKey: 'card.fury.text', descKey: 'card.fury.desc', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'fury', stacks: 1 }] },
  // Temperance is an INSTANT party buff (not a power): immediate Strength + Block to all allies.
  embolden: { id: 'embolden', upgradeTo: 'embolden_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'allAllies', nameKey: 'card.embolden.name', textKey: 'card.embolden.text', descKey: 'card.embolden.desc', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 1, target: 'allAllies' }, { kind: 'block', amount: 3, target: 'allAllies' }] },

  // --- scaling payoffs: attacks/blocks that grow with an accumulated metric (the engine payoffs) ---
  // Converts stacked Poison into burst WITHOUT consuming it (the rot keeps ticking).
  rupture: { id: 'rupture', upgradeTo: 'rupture_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.rupture.name', textKey: 'card.rupture.text', descKey: 'card.rupture.desc', rarity: 'uncommon', effects: [{ kind: 'damageScaling', per: 'poisonOnTarget', amount: 4, coeff: 1 }] },
  // Deals damage equal to your Block (non-consuming, coeff-capped) — the turtle payoff. Rare.
  shield_bash: { id: 'shield_bash', upgradeTo: 'shield_bash_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.shield_bash.name', textKey: 'card.shield_bash.text', descKey: 'card.shield_bash.desc', rarity: 'rare', effects: [{ kind: 'damageScaling', per: 'block', amount: 0, coeff: 1 }] },
  // Rewards being played LATE in a turn (after other cards) — bridges block + play-many tempo.
  shield_wall: { id: 'shield_wall', upgradeTo: 'shield_wall_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.shield_wall.name', textKey: 'card.shield_wall.text', descKey: 'card.shield_wall.desc', rarity: 'common', effects: [{ kind: 'blockScaling', per: 'cardsPlayedThisTurn', amount: 3, coeff: 2, target: 'self' }] },
  // Finisher: an execute that doubles against a near-dead foe.
  deathblow: { id: 'deathblow', upgradeTo: 'deathblow_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.deathblow.name', textKey: 'card.deathblow.text', descKey: 'card.deathblow.desc', rarity: 'uncommon', effects: [{ kind: 'execute', amount: 12, bonus: 12, below: 0.2 }] },
  // 0-cost cantrip: replaces itself and advances the card-count engines (Helmet / Shield Wall). maxCopies:1.
  foresight: { id: 'foresight', upgradeTo: 'foresight_plus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.foresight.name', textKey: 'card.foresight.text', descKey: 'card.foresight.desc', rarity: 'common', maxCopies: 1, effects: [{ kind: 'draw', count: 1 }] },

  // --- '+' honed variants for the rest of the flesh library (created by upgrading at a fire; never in
  //     the pool). Each bumps its base's numbers/effect. No descKey (the detail view shows name+text). ---
  strike_heavy_plus: { id: 'strike_heavy_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.strike_heavy_plus.name', textKey: 'card.strike_heavy_plus.text', rarity: 'common', effects: [{ kind: 'damage', amount: 14 }] },
  brace_plus: { id: 'brace_plus', type: 'skill', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.brace_plus.name', textKey: 'card.brace_plus.text', rarity: 'common', effects: [{ kind: 'block', amount: 11 }] },
  shove_plus: { id: 'shove_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.shove_plus.name', textKey: 'card.shove_plus.text', rarity: 'common', effects: [{ kind: 'damage', amount: 7 }, { kind: 'pushRow' }] },
  quickstep_plus: { id: 'quickstep_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.quickstep_plus.name', textKey: 'card.quickstep_plus.text', rarity: 'common', effects: [{ kind: 'draw', count: 3 }] },
  rally_plus: { id: 'rally_plus', type: 'skill', layer: 'flesh', cost: 2, target: 'allAllies', nameKey: 'card.rally_plus.name', textKey: 'card.rally_plus.text', rarity: 'uncommon', effects: [{ kind: 'block', amount: 5, target: 'allAllies' }] },
  subdue_plus: { id: 'subdue_plus', upgradeTo: 'subdue_plus_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.subdue_plus.name', textKey: 'card.subdue_plus.text', rarity: 'uncommon', nonLethal: true, effects: [{ kind: 'damage', amount: 12 }] },
  focus_plus: { id: 'focus_plus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.focus_plus.name', textKey: 'card.focus_plus.text', rarity: 'uncommon', effects: [{ kind: 'gainEnergy', amount: 1 }, { kind: 'draw', count: 1 }] },
  sharpen_plus: { id: 'sharpen_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'none', nameKey: 'card.sharpen_plus.name', textKey: 'card.sharpen_plus.text', rarity: 'uncommon', effects: [{ kind: 'hone', count: 2 }] },
  cast_off_plus: { id: 'cast_off_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'none', exhaust: true, nameKey: 'card.cast_off_plus.name', textKey: 'card.cast_off_plus.text', rarity: 'uncommon', effects: [{ kind: 'exhaustChosen', count: 3 }] },
  prepare_plus: { id: 'prepare_plus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.prepare_plus.name', textKey: 'card.prepare_plus.text', rarity: 'uncommon', effects: [{ kind: 'topDeck', count: 2 }] },
  riposte_plus: { id: 'riposte_plus', type: 'attack', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.riposte_plus.name', textKey: 'card.riposte_plus.text', rarity: 'common', effects: [{ kind: 'block', amount: 7 }, { kind: 'damage', amount: 7 }] },
  exhort_plus: { id: 'exhort_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'allAllies', nameKey: 'card.exhort_plus.name', textKey: 'card.exhort_plus.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'allAllies' }] },
  steadfast_plus: { id: 'steadfast_plus', type: 'power', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.steadfast_plus.name', textKey: 'card.steadfast_plus.text', rarity: 'uncommon', effects: [{ kind: 'block', amount: 6 }, { kind: 'gainPower', power: 'steadfast', stacks: 1 }] },
  venom_plus: { id: 'venom_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.venom_plus.name', textKey: 'card.venom_plus.text', rarity: 'common', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 6 }, { kind: 'spiritShift', amount: -15, reason: 'sowedAffliction' }] },
  miasma_plus: { id: 'miasma_plus', type: 'skill', layer: 'flesh', cost: 2, target: 'allEnemies', nameKey: 'card.miasma_plus.name', textKey: 'card.miasma_plus.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'poison', stacks: 3, target: 'allEnemies' }, { kind: 'spiritShift', amount: -25, reason: 'sowedAffliction' }] },
  expose_plus: { id: 'expose_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.expose_plus.name', textKey: 'card.expose_plus.text', rarity: 'common', effects: [{ kind: 'applyStatus', status: 'vulnerable', stacks: 3 }] },
  cripple_plus: { id: 'cripple_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.cripple_plus.name', textKey: 'card.cripple_plus.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'weak', stacks: 3 }, { kind: 'applyStatus', status: 'vulnerable', stacks: 2 }] },
  shackle_plus: { id: 'shackle_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'enemy', nameKey: 'card.shackle_plus.name', textKey: 'card.shackle_plus.text', rarity: 'rare', effects: [{ kind: 'applyStatus', status: 'bound', stacks: 1 }, { kind: 'applyStatus', status: 'weak', stacks: 2 }] },
  sure_hands_plus: { id: 'sure_hands_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.sure_hands_plus.name', textKey: 'card.sure_hands_plus.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'dexterity', stacks: 2, target: 'self' }] },
  menace_plus: { id: 'menace_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.menace_plus.name', textKey: 'card.menace_plus.text', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'menace', stacks: 2 }] },
  bulwark_plus: { id: 'bulwark_plus', type: 'power', layer: 'flesh', cost: 2, target: 'self', nameKey: 'card.bulwark_plus.name', textKey: 'card.bulwark_plus.text', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'bulwark', stacks: 4 }] },
  bastion_plus: { id: 'bastion_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.bastion_plus.name', textKey: 'card.bastion_plus.text', rarity: 'rare', effects: [{ kind: 'gainPower', power: 'bastion', stacks: 6 }] },
  momentum_plus: { id: 'momentum_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.momentum_plus.name', textKey: 'card.momentum_plus.text', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'momentum', stacks: 2 }] },
  whetstone_plus: { id: 'whetstone_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.whetstone_plus.name', textKey: 'card.whetstone_plus.text', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'whetstone', stacks: 3 }] },
  adrenaline_plus: { id: 'adrenaline_plus', type: 'power', layer: 'flesh', cost: 0, target: 'self', nameKey: 'card.adrenaline_plus.name', textKey: 'card.adrenaline_plus.text', rarity: 'common', effects: [{ kind: 'gainPower', power: 'adrenaline', stacks: 1 }] },
  fury_plus: { id: 'fury_plus', type: 'power', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.fury_plus.name', textKey: 'card.fury_plus.text', rarity: 'uncommon', effects: [{ kind: 'gainPower', power: 'fury', stacks: 2 }] },
  embolden_plus: { id: 'embolden_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'allAllies', nameKey: 'card.embolden_plus.name', textKey: 'card.embolden_plus.text', rarity: 'uncommon', effects: [{ kind: 'applyStatus', status: 'strength', stacks: 2, target: 'allAllies' }, { kind: 'block', amount: 5, target: 'allAllies' }] },
  rupture_plus: { id: 'rupture_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.rupture_plus.name', textKey: 'card.rupture_plus.text', rarity: 'uncommon', effects: [{ kind: 'damageScaling', per: 'poisonOnTarget', amount: 6, coeff: 1 }] },
  shield_bash_plus: { id: 'shield_bash_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.shield_bash_plus.name', textKey: 'card.shield_bash_plus.text', rarity: 'rare', effects: [{ kind: 'damageScaling', per: 'block', amount: 4, coeff: 1 }] },
  shield_wall_plus: { id: 'shield_wall_plus', type: 'skill', layer: 'flesh', cost: 1, target: 'self', nameKey: 'card.shield_wall_plus.name', textKey: 'card.shield_wall_plus.text', rarity: 'common', effects: [{ kind: 'blockScaling', per: 'cardsPlayedThisTurn', amount: 5, coeff: 2, target: 'self' }] },
  deathblow_plus: { id: 'deathblow_plus', type: 'attack', layer: 'flesh', cost: 2, target: 'enemy', nameKey: 'card.deathblow_plus.name', textKey: 'card.deathblow_plus.text', rarity: 'uncommon', effects: [{ kind: 'execute', amount: 16, bonus: 16, below: 0.25 }] },
  foresight_plus: { id: 'foresight_plus', type: 'skill', layer: 'flesh', cost: 0, target: 'none', nameKey: 'card.foresight_plus.name', textKey: 'card.foresight_plus.text', rarity: 'common', effects: [{ kind: 'draw', count: 2 }] },
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
