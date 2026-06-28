// Placeholder card "art": one emoji per card, centered in the .card-art block (styled in styles.css
// with a subtle desaturate + drop-shadow + layer-tinted glow). UI-side only — these are placeholders,
// mirroring the emoji combatant sprites (cf. spriteGlyph in CombatScreen). Swap for real art later.

// Keyed by card id. '+' upgrade variants reuse their base art.
const CARD_ART: Record<string, string> = {
  // flesh — attacks
  strike: '⚔️',
  strike_plus: '⚔️',
  strike_heavy: '⚔️',
  flurry: '🗡️',
  flurry_plus: '🗡️',
  shove: '👊',
  riposte: '🤺',
  subdue: '😵',
  // flesh — skills / defense / utility
  guard: '🛡️',
  guard_plus: '🛡️',
  brace: '🧱',
  second_wind: '💨',
  second_wind_plus: '💨',
  quickstep: '👣',
  rally: '📣',
  exhort: '💪',
  focus: '🎯',
  steadfast: '🗿',
  // flesh — card manipulation
  sharpen: '⚒️',
  cast_off: '🪶',
  prepare: '🛤️',
  // flesh — debuffs (ids keep old names; display is plain — see i18n)
  venom: '🐍', // Venom
  miasma: '🌫️', // Miasma
  expose: '🩸', // Expose
  cripple: '🩼', // Cripple
  shackle: '🔗', // Shackle
  // flesh — buffs / persistent powers
  sure_hands: '🧤', // Sure Hands (dexterity)
  menace: '😠', // Menace
  bulwark: '🏰', // Bulwark
  bastion: '🗼', // Bastion
  momentum: '🌀', // Momentum
  whetstone: '🔪', // Whetstone
  adrenaline: '⚡', // Adrenaline
  fury: '🔥', // Fury
  embolden: '🦁', // Embolden
  // flesh — scaling payoffs
  rupture: '💥', // Rupture
  shield_bash: '🤜', // Shield Bash
  shield_wall: '🚧', // Shield Wall
  deathblow: '💀', // Deathblow
  foresight: '🔮', // Foresight
  // enemy clutter
  spike: '🌵',
  // spirit — verses (miracles)
  verse_zech_4_6: '✨',
  verse_phil_4_6: '🙏',
  verse_luke_10_27: '❤️',
  verse_2kings_6_17: '👁️',
}

/** The emoji for a card, looked up from its nameKey (`card.<id>.name`). Falls back by layer so a new
 *  card without a mapping still shows something on-theme. */
export function cardArt(nameKey: string, layer: string): string {
  const id = nameKey.split('.')[1] ?? ''
  // '+' honed variants reuse their base card's art (strip the _plus suffix).
  const baseId = id.endsWith('_plus') ? id.slice(0, -'_plus'.length) : id
  return CARD_ART[id] ?? CARD_ART[baseId] ?? (layer === 'spirit' ? '✨' : '🃏')
}
