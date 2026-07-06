// Per-player colors for co-op: each party member gets a stable, distinct hue so the shared hand, the
// HUD hero chips, and the "who does this card affect" glow all read as the same identity. Deterministic
// from party ORDER (party[0]=host=first color), so every client agrees without any extra state.

/** Distinct, legible-on-dark accent colors, in party-seat order (max party is 3, a 4th for safety). */
const PALETTE = ['#e0b64f', '#5aa9e6', '#7ed17e', '#d98cc9'] as const

/** The accent color for a member, by its index in the party order. Falls back to gold for unknown ids. */
export function playerColor(memberId: string, partyOrder: readonly string[]): string {
  const i = partyOrder.indexOf(memberId)
  return i >= 0 ? PALETTE[i % PALETTE.length]! : PALETTE[0]!
}
