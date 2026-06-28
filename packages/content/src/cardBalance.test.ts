import { describe, expect, it } from 'vitest'
import { CARDS } from './cards'

// Balance guardrails for the new buff/effect/power cards. (i18n coverage + pool/upgrade refs are
// already checked in content.integration.test.ts.)

describe('card balance invariants', () => {
  it('no card nets more than +1 energy on its own (energy-loop guard)', () => {
    // A 0-cost card that grants >1 net energy (or any card whose gainEnergy exceeds cost+1) reopens an
    // infinite-energy loop once draw/energy powers exist. Gospel-Shod refunds via a once-per-turn power
    // hook (no gainEnergy op on the card), so it is not counted here.
    for (const card of Object.values(CARDS)) {
      const energyGain = card.effects.reduce((sum, e) => (e.kind === 'gainEnergy' ? sum + e.amount : sum), 0)
      expect(energyGain - card.cost, `card "${card.id}" nets ${energyGain - card.cost} energy`).toBeLessThanOrEqual(1)
    }
  })

  it('0-cost engine cards are copy-capped (focus, foresight)', () => {
    expect(CARDS.focus?.maxCopies).toBe(1)
    expect(CARDS.foresight?.maxCopies).toBe(1)
  })

  it('the draw/energy powers are copy-capped to keep their payoff bounded', () => {
    expect(CARDS.momentum?.maxCopies).toBe(1)
    expect(CARDS.adrenaline?.maxCopies).toBe(1)
  })

  it('poison cards carry a Spirit toll (pure temptation — a Spirit run avoids them)', () => {
    for (const id of ['venom', 'miasma']) {
      const card = CARDS[id]!
      const toll = card.effects.find((e) => e.kind === 'spiritShift')
      expect(toll, `${id} should grieve Spirit`).toBeTruthy()
      if (toll && toll.kind === 'spiritShift') expect(toll.amount).toBeLessThan(0)
    }
  })

  it('Deathblow is an execute that doubles below 20% HP', () => {
    const op = CARDS.deathblow?.effects.find((e) => e.kind === 'execute')
    expect(op && op.kind === 'execute' ? { a: op.amount, b: op.bonus, below: op.below } : null).toEqual({ a: 12, b: 12, below: 0.2 })
  })
})
