// Applying an item's effects OUTSIDE combat (in a scene / on the map). There is no CombatState here,
// so rather than spin up a fake battle we apply the few effects that make sense on the persistent
// party directly. Magnitudes are LITERAL (no level/Spirit scaling) — a deliberate, documented
// asymmetry vs. combat (where an item is wrapped in a flesh card and scales by the user's level).

import type { GameEvent } from '../events/event'
import type { SpiritEvent } from '../spirit/spirit'
import { memberMaxHp, type PartyMember } from '../state/character'
import type { MemberId } from '../types'
import type { ItemDef } from './types'

export interface PartyItemOutcome {
  party: PartyMember[]
  events: GameEvent[]
  spiritEvents: SpiritEvent[]
}

/** Apply a self-used item's effects to the hero. Heals clamp to maxHp (at full HP, delta 0). Effects
 *  with no out-of-combat meaning (block / status / draw / energy / miracles) emit a `notice`. */
export function applyItemEffectsToParty(
  party: PartyMember[],
  heroMemberId: MemberId,
  item: ItemDef,
): PartyItemOutcome {
  let next = party
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []

  const patchHero = (fn: (m: PartyMember) => PartyMember) =>
    (next = next.map((m) => (m.memberId === heroMemberId ? fn(m) : m)))

  for (const op of item.effects ?? []) {
    switch (op.kind) {
      case 'heal': {
        const hero = next.find((m) => m.memberId === heroMemberId)
        if (!hero) break
        const after = Math.min(memberMaxHp(hero), hero.currentHp + op.amount)
        const delta = after - hero.currentHp
        patchHero((m) => ({ ...m, currentHp: after }))
        events.push({ type: 'healed', targetId: heroMemberId, amount: delta })
        break
      }
      case 'spiritShift':
        spiritEvents.push({ kind: 'moralChoice', delta: op.amount, reason: op.reason })
        break
      default:
        // block / applyStatus / draw / gainEnergy / pushRow / miracles / card-target ops are
        // combat-only — surface a notice so an authoring mistake is visible, not silent.
        events.push({ type: 'notice', messageKey: 'item.noEffectHere' })
    }
  }

  return { party: next, events, spiritEvents }
}
