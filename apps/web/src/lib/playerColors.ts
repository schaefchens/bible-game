// Per-player identity for co-op: each party member gets a stable, distinct COLOR + SHAPE so the shared
// hand, the HUD chips, the deck/pick legends, and the battlefield names all read as one identity.
// Both are deterministic from party ORDER (party[0]=host=first), so every client agrees with no extra
// state. The shapes are monochrome glyphs (not multicolor emoji) so they inherit the player's color —
// shape + color reinforce each other and stay legible for colour‑blind players.

/** Distinct, legible-on-dark accent colors, in party-seat order (max party is 3, a 4th for safety). */
const PALETTE = ['#e0b64f', '#5aa9e6', '#7ed17e', '#d98cc9'] as const

/** Clean, distinct, TINTABLE shapes (star / moon / sun / triangle), paired by seat with the palette. */
const SYMBOLS = ['★', '☾', '☀', '▲'] as const

/** The accent color for a member, by its index in the party order. Falls back to gold for unknown ids. */
export function playerColor(memberId: string, partyOrder: readonly string[]): string {
  const i = partyOrder.indexOf(memberId)
  return i >= 0 ? PALETTE[i % PALETTE.length]! : PALETTE[0]!
}

/** The identity shape for a member, by its index in the party order. Rendered in the member's color. */
export function playerSymbol(memberId: string, partyOrder: readonly string[]): string {
  const i = partyOrder.indexOf(memberId)
  return i >= 0 ? SYMBOLS[i % SYMBOLS.length]! : SYMBOLS[0]!
}
