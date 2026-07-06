// The combat engine core: pure functions over CombatState. Each player action returns a
// CombatStep { combat, events, spiritEvents }. Spirit is NOT mutated here — combat emits
// SpiritEvent intents that the combat reducer applies to run.spirit (single-writer rule), and
// reads the current spirit scalar (passed in) only to scale spiritual effects via potencyMult.

import type { CardDef, CardInstance, EffectOp, PowerId, StatusId, TargetKind } from '../cards/types'
import { itemPseudoCard, type ItemDef } from '../inventory/types'
import type { GameEvent } from '../events/event'
import { getGrace } from '../grace/grace'
import { miracleChance, scaleSpiritValue } from '../spirit/spirit'
import type { SpiritEvent } from '../spirit/spirit'
import { chance, fork, nextFloat, pick, shuffle, type RngState } from '../rng/rng'
import type { CardDefId, CombatantId, GraceAbilityId, MemberId } from '../types'
import { pickIntent } from './ai'
import { absorb, dexterityBlockBonus, executeDamageBase, physicalAmount, powerStacks, scalingDamageBase, statusStacks, swordBonus } from './damage'
import { POWERS, type HookName } from './powers'
import type {
  CombatFlags,
  Combatant,
  CombatState,
  FormationLayout,
  RewardChoice,
  RewardOption,
  Row,
  Side,
  WinCondition,
} from './types'

export const HAND_SIZE = 5

export interface CombatStep {
  combat: CombatState
  events: GameEvent[]
  spiritEvents: SpiritEvent[]
}

const step = (combat: CombatState, events: GameEvent[] = [], spiritEvents: SpiritEvent[] = []): CombatStep => ({
  combat,
  events,
  spiritEvents,
})

const reject = (combat: CombatState, reason: string): CombatStep =>
  step(combat, [{ type: 'rejected', reason }])

// ---- combatant helpers ------------------------------------------------------------------

const getC = (c: CombatState, id: CombatantId): Combatant | undefined => c.combatants[id]

function withCombatant(c: CombatState, id: CombatantId, fn: (x: Combatant) => Combatant): CombatState {
  const cur = c.combatants[id]
  if (!cur) return c
  return { ...c, combatants: { ...c.combatants, [id]: fn(cur) } }
}

const aliveParty = (c: CombatState): Combatant[] =>
  c.partyOrder.map((id) => c.combatants[id]!).filter((x) => x.alive)

/** Enemies that are alive AND revealed (hidden demons are not yet targetable). */
const targetableEnemies = (c: CombatState): Combatant[] =>
  c.enemyOrder.map((id) => c.combatants[id]!).filter((x) => x.alive && !x.hidden)

/** The faction OPPOSING `source` — its targetable members. For a party source this is the enemies;
 *  for an enemy source it is the living party. Makes effect targeting source-relative. */
const opposingTargetable = (c: CombatState, source: Combatant): Combatant[] =>
  source.faction === 'party' ? targetableEnemies(c) : aliveParty(c)

/** `source`'s OWN faction — its living members. Enemy "allies" reuse `targetableEnemies`, so a
 *  not-yet-revealed bound demon is never counted as an ally (e.g. a shield-bearer can't screen it). */
const ownFactionAlive = (c: CombatState, source: Combatant): Combatant[] =>
  source.faction === 'party' ? aliveParty(c) : targetableEnemies(c)

const aliveDemons = (c: CombatState): Combatant[] =>
  Object.values(c.combatants).filter((x) => x.faction === 'enemy' && x.alive && x.isDemon)

const aliveHumanEnemies = (c: CombatState): Combatant[] =>
  Object.values(c.combatants).filter((x) => x.faction === 'enemy' && x.alive && x.isHuman)

// ---- card / effect resolution -----------------------------------------------------------

/** The def a copy currently resolves to — its honed (`+`) form once a `hone` effect has marked it,
 *  else its base def. The single seam through which honing affects cost/effects/exhaust/display. */
function cardDef(c: CombatState, inst: CardInstance): CardDef | undefined {
  return c.cardDefs[inst.honedDefId ?? inst.defId]
}

/** Find a card copy by iid across the live piles (hand / draw / discard — not exhaust). */
function findInstance(c: CombatState, iid: string): CardInstance | undefined {
  return c.hand.find((x) => x.iid === iid) ?? c.drawPile.find((x) => x.iid === iid) ?? c.discardPile.find((x) => x.iid === iid)
}

/** Map a single card copy (by iid) in whichever live pile holds it. No-op if not found. */
function withCardInstance(c: CombatState, iid: string, fn: (x: CardInstance) => CardInstance): CombatState {
  const upd = (pile: CardInstance[]): CardInstance[] => {
    const idx = pile.findIndex((x) => x.iid === iid)
    if (idx < 0) return pile
    const next = [...pile]
    next[idx] = fn(next[idx]!)
    return next
  }
  return { ...c, hand: upd(c.hand), drawPile: upd(c.drawPile), discardPile: upd(c.discardPile) }
}

/** Pull a card copy out of whichever live pile holds it (hand / draw / discard). */
function removeFromPiles(c: CombatState, iid: string): { combat: CombatState; inst?: CardInstance } {
  for (const pile of ['hand', 'drawPile', 'discardPile'] as const) {
    const idx = c[pile].findIndex((x) => x.iid === iid)
    if (idx >= 0) {
      const inst = c[pile][idx]!
      const next = [...c[pile]]
      next.splice(idx, 1)
      return { combat: { ...c, [pile]: next }, inst }
    }
  }
  return { combat: c }
}

/** Mint `count` fresh card copies of `defId` and append them to a party pile (enemy clutter). The
 *  cards carry a living member's `ownerId` so death-purge stays consistent. Uses `nextIid` for ids. */
function injectCards(c: CombatState, defId: CardDefId, count: number, pile: 'draw' | 'discard', ownerId: MemberId): CombatStep {
  if (count <= 0) return step(c)
  let nextIid = c.nextIid
  const added: CardInstance[] = []
  const iids: string[] = []
  for (let i = 0; i < count; i++) {
    const iid = `${defId}#inj${nextIid++}`
    added.push({ iid, defId, ownerId })
    iids.push(iid)
  }
  const key = pile === 'draw' ? 'drawPile' : 'discardPile'
  const combat: CombatState = { ...c, [key]: [...c[key], ...added], nextIid }
  return step(combat, [{ type: 'cardsInjected', defId, iids, pile }])
}

// Targets are resolved RELATIVE to the source's faction: 'ally'/'allAllies' = the source's own side,
// 'enemy'/'allEnemies' = the opposing side. For a PARTY source this is identical to the old hardcoded
// behavior (own=party, opposing=enemies) — so player cards/items/powers are unaffected. An ENEMY source
// (an enemy power or, later, an enemy move) now correctly buffs its own line and afflicts the party.
function resolveTargets(
  c: CombatState,
  sourceId: CombatantId,
  target: TargetKind,
  chosenId: CombatantId | undefined,
): CombatantId[] {
  const source = getC(c, sourceId)
  if (!source) return []
  switch (target) {
    case 'self':
      return [sourceId]
    case 'allAllies':
      return ownFactionAlive(c, source).map((x) => x.id)
    case 'allEnemies':
      return opposingTargetable(c, source).map((x) => x.id)
    case 'ally': {
      // a chosen member of the SOURCE's own faction, else the source itself
      const chosen = chosenId ? getC(c, chosenId) : undefined
      const ok = chosen && chosen.faction === source.faction && chosen.alive && !chosen.hidden
      return [ok ? chosenId! : sourceId]
    }
    case 'enemy': {
      // a chosen targetable OPPONENT, else the front-of-list living opponent
      const chosen = chosenId ? getC(c, chosenId) : undefined
      if (chosen && chosen.faction !== source.faction && chosen.alive && !chosen.hidden) return [chosenId!]
      const first = opposingTargetable(c, source)[0]
      return first ? [first.id] : []
    }
    case 'none':
      return []
  }
}

/** Apply raw damage to a target: block absorption, Divine Protection, HP, and death routing.
 *  `fromDot` (poison) is internal expose: it skips the physical pipeline (no strength/weak/
 *  vulnerable/row, no lastStand mitigation) AND skips the block pool — only HP — but still routes a
 *  lethal tick through killCombatant, so poisoning a human to death griefs Spirit like any blow. */
function damageTarget(
  c: CombatState,
  sourceId: CombatantId,
  targetId: CombatantId,
  rawBase: number,
  opts: { nonLethal: boolean; fromDot?: boolean },
): CombatStep {
  const source = getC(c, sourceId)
  const target = getC(c, targetId)
  if (!source || !target || !target.alive) return step(c)

  const hit = opts.fromDot ? { amount: Math.max(0, Math.floor(rawBase)), capped: false } : physicalAmount(rawBase, source, target)
  const split = opts.fromDot ? { blocked: 0, hpDamage: hit.amount, remainingBlock: target.block } : absorb(hit.amount, target.block)

  let hpDamage = split.hpDamage
  let rng = c.rng
  const events: GameEvent[] = []
  // Divine Protection miracle: a successful Spirit-scaled roll caps this hit at 1 (party only). DoT is
  // not a "hit" and bypasses the shield.
  if (!opts.fromDot && target.faction === 'party' && target.shield && hpDamage > 1) {
    const [negate, ns] = chance(rng, target.shield.chance)
    rng = ns
    if (negate) {
      hpDamage = 1
      events.push({ type: 'shieldNegated', targetId })
    }
  }
  // Bastion power: the FIRST HP-damaging hit each round on a party member is blunted by
  // stacks×scale (a flat reduction, like Strength/Dexterity reads — not a hook). Once per round.
  let usedShield = false
  if (!opts.fromDot && target.faction === 'party' && hpDamage > 0 && !c.shieldUsedThisRound.includes(targetId) && powerStacks(target, 'bastion') > 0) {
    hpDamage = Math.max(0, hpDamage - powerStacks(target, 'bastion') * target.scale)
    usedShield = true
    events.push({ type: 'shieldNegated', targetId })
  }

  const hp = target.hp - hpDamage
  events.unshift({ type: 'damageDealt', targetId, amount: hpDamage, blocked: split.blocked, capped: hit.capped })
  const spiritEvents: SpiritEvent[] = []

  // Non-lethal vs humans: never drops below 1; instead subdues.
  const lethal = hp <= 0
  const subdue = lethal && opts.nonLethal && target.isHuman

  let next: Combatant = {
    ...target,
    hp: subdue ? 1 : Math.max(0, hp),
    block: split.remainingBlock,
  }

  let outCombat = { ...c, rng, combatants: { ...c.combatants, [targetId]: next } }
  if (usedShield) outCombat = { ...outCombat, shieldUsedThisRound: [...outCombat.shieldUsedThisRound, targetId] }

  if (subdue) {
    next = { ...next, alive: false, subdued: true }
    outCombat = { ...outCombat, combatants: { ...outCombat.combatants, [targetId]: next } }
    events.push({ type: 'combatantDied', id: targetId, isHuman: true, mode: 'subdued' })
    spiritEvents.push({ kind: 'spareHuman' })
  } else if (lethal) {
    const death = killCombatant(outCombat, targetId, false)
    outCombat = death.combat
    events.push(...death.events)
    spiritEvents.push(...death.spiritEvents)
  }

  return step(outCombat, events, spiritEvents)
}

/** Resolve a death: humans grief Spirit (worse if a grace path existed); demons/beasts are clean. */
function killCombatant(c: CombatState, id: CombatantId, viaMercy: boolean): CombatStep {
  const victim = getC(c, id)
  if (!victim) return step(c)
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []

  if (victim.faction === 'party') {
    return purgePartyMember(c, id)
  }

  // enemy death
  let mode: 'killed' | 'subdued' = 'killed'
  let killedHumanDelta = 0
  if (victim.isHuman) {
    if (viaMercy) {
      mode = 'subdued'
      spiritEvents.push({ kind: 'spareHuman' })
    } else {
      const graceWasAvailable =
        victim.revealsId !== undefined && (getC(c, victim.revealsId)?.alive ?? false)
      spiritEvents.push({ kind: 'killHuman', graceWasAvailable })
      killedHumanDelta = 1
    }
  }
  let out = withCombatant(c, id, (x) => ({ ...x, alive: false, hp: 0, subdued: mode === 'subdued' }))
  if (killedHumanDelta) out = { ...out, humansKilled: out.humansKilled + killedHumanDelta }
  events.push({ type: 'combatantDied', id, isHuman: victim.isHuman, mode })
  return step(out, events, spiritEvents)
}

/** Companion/hero death: purge ALL their contributed cards from every pile + drop their energy. */
function purgePartyMember(c: CombatState, id: CombatantId): CombatStep {
  const member = getC(c, id)
  if (!member) return step(c)
  const memberId = member.memberId
  const keep = (ci: CardInstance) => ci.ownerId !== memberId
  const newMax = Math.max(0, c.energy.max - (member.contributesEnergy ?? 0))

  const out: CombatState = {
    ...c,
    combatants: { ...c.combatants, [id]: { ...member, alive: false, hp: 0 } },
    drawPile: c.drawPile.filter(keep),
    hand: c.hand.filter(keep),
    discardPile: c.discardPile.filter(keep),
    exhaustPile: c.exhaustPile.filter(keep),
    energy: { max: newMax, current: Math.min(c.energy.current, newMax) },
  }
  const events: GameEvent[] = [{ type: 'combatantDied', id, isHuman: member.isHuman, mode: 'killed' }]
  if (memberId) events.push({ type: 'partyMemberDied', memberId })
  return step(out, events)
}

function applyStatusTo(c: CombatState, id: CombatantId, status: StatusId, stacks: number): CombatState {
  return withCombatant(c, id, (x) => {
    const existing = x.statuses.find((s) => s.id === status)
    const statuses = existing
      ? x.statuses.map((s) => (s.id === status ? { ...s, stacks: s.stacks + stacks } : s))
      : [...x.statuses, { id: status, stacks }]
    return { ...x, statuses }
  })
}

/** install/stack a persistent power on a combatant (mirror of applyStatusTo). */
function withPower(c: CombatState, id: CombatantId, power: PowerId, stacks: number): CombatState {
  return withCombatant(c, id, (x) => {
    const powers = x.powers ?? []
    const existing = powers.find((p) => p.id === power)
    const next = existing
      ? powers.map((p) => (p.id === power ? { ...p, stacks: p.stacks + stacks } : p))
      : [...powers, { id: power, stacks }]
    return { ...x, powers: next }
  })
}

/** A flesh pseudo-card giving applyEffect a `card` for power-emitted ops (flesh ⇒ scale by level). */
const POWER_PSEUDO_CARD: CardDef = { id: 'power', type: 'power', layer: 'flesh', cost: 0, target: 'self', nameKey: '', textKey: '', effects: [] }

/** Fire a power hook for ONE combatant: fold each held power's emitted EffectOps through the SAME
 *  applyEffect interpreter cards use (like the def.effects loop in playCard). Pure. Re-entrancy-safe:
 *  hooks fire only from the FSM (beginRound/playCard), never from inside applyEffect, so an emitted op
 *  cannot re-fire a hook with the MVP hook set. */
function firePowerHook(c: CombatState, hook: HookName, id: CombatantId): CombatStep {
  const holder = getC(c, id)
  if (!holder || !holder.alive || !holder.powers?.length) return step(c)
  let combat = c
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []
  for (const p of holder.powers) {
    const fn = POWERS[p.id]?.hooks[hook]
    if (!fn) continue
    const self = getC(combat, id)
    if (!self || !self.alive) continue
    const ops = fn({ self, stacks: p.stacks, combat })
    if (!ops.length) continue
    for (const op of ops) {
      const r = applyEffect(combat, op, id, undefined, 'self', 0, POWER_PSEUDO_CARD)
      combat = r.combat
      events.push(...r.events)
      spiritEvents.push(...r.spiritEvents)
    }
    events.push({ type: 'powerTriggered', sourceId: id, power: p.id })
  }
  return step(combat, events, spiritEvents)
}

/** Fire a hook for every alive party combatant that holds powers (party-wide events). */
function firePartyPowers(c: CombatState, hook: HookName): CombatStep {
  let combat = c
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []
  for (const id of combat.partyOrder) {
    const r = firePowerHook(combat, hook, id)
    combat = r.combat
    events.push(...r.events)
    spiritEvents.push(...r.spiritEvents)
  }
  return step(combat, events, spiritEvents)
}

/** Fire a hook for every revealed enemy that holds powers — the mirror of firePartyPowers for enemy
 *  auras (Aegis line-screen, War-Leader rally). `firePowerHook` already skips dead/power-less holders,
 *  so an aura simply stops the round its holder dies ("as long as he lives"). enemyOrder excludes
 *  hidden demons, so a not-yet-revealed idol's aura lies dormant until Sight reveals it. */
function fireEnemyPowers(c: CombatState, hook: HookName): CombatStep {
  let combat = c
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []
  for (const id of combat.enemyOrder) {
    const r = firePowerHook(combat, hook, id)
    combat = r.combat
    events.push(...r.events)
    spiritEvents.push(...r.spiritEvents)
  }
  return step(combat, events, spiritEvents)
}

/**
 * "Last stand": the instant a flagged foe becomes the SOLE living (revealed) enemy it rallies — steps
 * to the front (so the buff isn't swallowed by a back-row penalty) and gains the reusable `lastStand`
 * buff (deals ×2, takes ×½, applied in physicalAmount). Idempotent: re-checked wherever combat
 * continues (finalizeIfEnded), but applied once. The buff is GENERIC — any future trigger can grant
 * `lastStand` to any combatant; this is just the "alone" trigger.
 */
function refreshLastStand(c: CombatState): CombatStep {
  const living = c.enemyOrder.map((id) => c.combatants[id]!).filter((x) => x.alive && !x.hidden)
  if (living.length !== 1) return step(c)
  const lone = living[0]!
  if (!lone.lastStandWhenAlone || statusStacks(lone, 'lastStand') > 0) return step(c)
  const combat = applyStatusTo(withCombatant(c, lone.id, (x) => ({ ...x, row: 'front' })), lone.id, 'lastStand', 1)
  return step(combat, [{ type: 'statusApplied', targetId: lone.id, status: 'lastStand', stacks: 1 }])
}

/**
 * Magnitude of a numeric op. `spirit` cards scale by Spirit potency (verse cards fizzle to 0 when
 * carnal — no floor; other spirit cards keep a floor). `flesh` cards scale by the attacker's level.
 */
function spiritScaled(card: CardDef, amount: number, spirit: number, scale: number, opts?: { floor?: number }): number {
  if (card.layer !== 'spirit') return amount * scale
  const floor = card.type === 'verse' ? undefined : opts?.floor
  return scaleSpiritValue(amount, spirit, floor !== undefined ? { floor } : {})
}

/** Resolve a single EffectOp. `spirit` scales spirit-layer ops via potencyMult. */
function applyEffect(
  c: CombatState,
  op: EffectOp,
  sourceId: CombatantId,
  chosenId: CombatantId | undefined,
  defaultTarget: TargetKind,
  spirit: number,
  card: CardDef,
  cardTargetIids: string[] = [],
): CombatStep {
  const source = getC(c, sourceId)
  if (!source) return step(c)
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []
  let combat = c

  switch (op.kind) {
    case 'damage': {
      const targets = resolveTargets(combat, sourceId, op.target ?? defaultTarget, chosenId)
      const hits = op.hits ?? 1
      const baseScaled = spiritScaled(card, op.amount, spirit, source.scale)
      if (baseScaled <= 0) return step(combat, [{ type: 'cardFizzled', iid: '', defId: card.id, reason: 'lowSpirit' }])
      // Whetstone: a flat per-attack damage floor (×scale), added to the base so it amplifies
      // through Vulnerable. Single-hit attacks only — multi-hit gets its payoff from Strength instead.
      const base = baseScaled + swordBonus(card, source, hits)
      for (const tid of targets) {
        for (let h = 0; h < hits; h++) {
          const r = damageTarget(combat, sourceId, tid, base, { nonLethal: card.nonLethal ?? false })
          combat = r.combat
          events.push(...r.events)
          spiritEvents.push(...r.spiritEvents)
        }
      }
      return step(combat, events, spiritEvents)
    }
    case 'block': {
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      // Dexterity (the block-mirror of Strength) adds stacks×scale to block gained, read on the
      // casting source — exactly as Strength adds to damage in physicalAmount.
      const amount = spiritScaled(card, op.amount, spirit, source.scale, { floor: 1 }) + dexterityBlockBonus(source)
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) => ({ ...x, block: x.block + amount }))
        events.push({ type: 'blockGained', targetId: tid, amount })
      }
      return step(combat, events)
    }
    case 'damageScaling': {
      const targets = resolveTargets(combat, sourceId, op.target ?? defaultTarget, chosenId)
      const base = scalingDamageBase(op, source, combat, targets[0] ? getC(combat, targets[0]) : undefined)
      if (base <= 0) return step(combat, events)
      for (const tid of targets) {
        const r = damageTarget(combat, sourceId, tid, base, { nonLethal: card.nonLethal ?? false })
        combat = r.combat
        events.push(...r.events)
        spiritEvents.push(...r.spiritEvents)
      }
      return step(combat, events, spiritEvents)
    }
    case 'blockScaling': {
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      // reuse the shared scaling-base helper (same formula as damageScaling) + Dexterity on top
      const amount = scalingDamageBase(op, source, combat, undefined) + dexterityBlockBonus(source)
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) => ({ ...x, block: x.block + amount }))
        events.push({ type: 'blockGained', targetId: tid, amount })
      }
      return step(combat, events)
    }
    case 'execute': {
      const targets = resolveTargets(combat, sourceId, op.target ?? defaultTarget, chosenId)
      for (const tid of targets) {
        const base = executeDamageBase(op, source, getC(combat, tid)) + swordBonus(card, source, 1)
        if (base <= 0) continue
        const r = damageTarget(combat, sourceId, tid, base, { nonLethal: card.nonLethal ?? false })
        combat = r.combat
        events.push(...r.events)
        spiritEvents.push(...r.spiritEvents)
      }
      return step(combat, events, spiritEvents)
    }
    case 'heal': {
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      const amount = spiritScaled(card, op.amount, spirit, source.scale, { floor: 1 })
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) => ({ ...x, hp: Math.min(x.maxHp, x.hp + amount) }))
        events.push({ type: 'healed', targetId: tid, amount })
      }
      return step(combat, events)
    }
    case 'applyStatus': {
      const targets = resolveTargets(combat, sourceId, op.target ?? defaultTarget, chosenId)
      for (const tid of targets) {
        combat = applyStatusTo(combat, tid, op.status, op.stacks)
        events.push({ type: 'statusApplied', targetId: tid, status: op.status, stacks: op.stacks })
      }
      return step(combat, events)
    }
    case 'gainPower': {
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      for (const tid of targets) {
        combat = withPower(combat, tid, op.power, op.stacks)
        events.push({ type: 'powerGained', targetId: tid, power: op.power, stacks: op.stacks })
      }
      return step(combat, events)
    }
    case 'draw': {
      const r = drawCards(combat, op.count)
      return step(r.combat, r.events)
    }
    case 'gainEnergy': {
      combat = { ...combat, energy: { ...combat.energy, current: combat.energy.current + op.amount } }
      events.push({ type: 'energyChanged', current: combat.energy.current, max: combat.energy.max })
      return step(combat, events)
    }
    case 'pushRow': {
      const targets = resolveTargets(combat, sourceId, op.target ?? defaultTarget, chosenId)
      for (const tid of targets) combat = withCombatant(combat, tid, (x) => ({ ...x, row: 'back' }))
      return step(combat, events)
    }
    case 'spiritShift': {
      spiritEvents.push({ kind: 'moralChoice', delta: op.amount, reason: op.reason })
      return step(combat, events, spiritEvents)
    }
    case 'revealHidden': {
      // "Open My Eyes" (Sight): applied to a foe → reveal the demon bound to it (single-demon
      // encounters today → effectively reveals the one hidden demon).
      return revealDemons(combat, chosenId)
    }
    case 'banish': {
      // MIRACLE: Spirit-scaled chance to remove a random non-immune enemy from battle (no kill grief).
      const [hit, rng1] = chance(combat.rng, miracleChance(spirit, op.floor, op.cap))
      combat = { ...combat, rng: rng1 }
      events.push({ type: 'banishAttempt', success: hit })
      if (!hit) return step(combat, events)
      const candidates = combat.enemyOrder.filter((id) => {
        const x = combat.combatants[id]
        return x?.alive && !x.hidden && !x.banishImmune
      })
      const [chosen, rng2] = pick(combat.rng, candidates)
      combat = { ...combat, rng: rng2 }
      if (!chosen) return step(combat, events)
      combat = withCombatant(combat, chosen, (x) => ({ ...x, alive: false, hp: 0 }))
      events.push({ type: 'combatantBanished', id: chosen })
      return step(combat, events)
    }
    case 'protect': {
      // MIRACLE: grant a shield whose per-hit negate chance is snapshotted from current Spirit.
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      const ch = miracleChance(spirit, op.floor, op.cap)
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) => ({ ...x, shield: { turns: op.turns, chance: ch } }))
        events.push({ type: 'protected', targetId: tid, turns: op.turns, chance: ch })
      }
      return step(combat, events)
    }
    case 'hone': {
      // Temporarily upgrade up to `count` chosen cards by ONE level for the rest of the battle. Climbs
      // a multi-level chain: a card already honed to its `+` can be honed again to `++`/`+++`, as long
      // as its CURRENT resolved form still has an `upgradeTo`.
      const honed: string[] = []
      for (const tid of cardTargetIids.slice(0, op.count)) {
        const inst = findInstance(combat, tid)
        if (!inst) continue
        const currentId = inst.honedDefId ?? inst.defId
        const toId = combat.cardDefs[currentId]?.upgradeTo
        if (!toId || !combat.cardDefs[toId]) continue
        combat = withCardInstance(combat, tid, (x) => ({ ...x, honedDefId: toId }))
        honed.push(tid)
      }
      if (honed.length) events.push({ type: 'cardsHoned', iids: honed })
      return step(combat, events)
    }
    case 'exhaustChosen': {
      // Banish up to `count` chosen cards to the exhaust pile for the rest of the battle.
      const moved: string[] = []
      for (const tid of cardTargetIids.slice(0, op.count)) {
        const r = removeFromPiles(combat, tid)
        if (!r.inst) continue
        combat = { ...r.combat, exhaustPile: [...r.combat.exhaustPile, r.inst] }
        moved.push(tid)
      }
      if (moved.length) events.push({ type: 'cardsExhausted', iids: moved })
      return step(combat, events)
    }
    case 'topDeck': {
      // Place up to `count` chosen cards on TOP of the draw pile. Process in reverse so the first
      // chosen card ends up on the very top (drawn first next round).
      const moved: string[] = []
      for (const tid of cardTargetIids.slice(0, op.count).reverse()) {
        const r = removeFromPiles(combat, tid)
        if (!r.inst) continue
        combat = { ...r.combat, drawPile: [r.inst, ...r.combat.drawPile] }
        moved.push(tid)
      }
      if (moved.length) events.push({ type: 'cardsTopDecked', iids: moved })
      return step(combat, events)
    }
  }
}

// ---- piles ------------------------------------------------------------------------------

function drawCards(c: CombatState, n: number): { combat: CombatState; events: GameEvent[] } {
  let combat = c
  const events: GameEvent[] = []
  for (let i = 0; i < n; i++) {
    if (combat.drawPile.length === 0) {
      if (combat.discardPile.length === 0) break
      const [shuffled, rng] = shuffle(combat.rng, combat.discardPile)
      combat = { ...combat, drawPile: shuffled, discardPile: [], rng }
    }
    const [top, ...rest] = combat.drawPile
    if (!top) break
    combat = { ...combat, drawPile: rest, hand: [...combat.hand, top] }
    events.push({ type: 'cardDrawn', iid: top.iid })
  }
  return { combat, events }
}

// ---- Sight (grace) ----------------------------------------------------------------------

// Reveal hidden demons. When `viaHostId` is the human a Sight card was applied to, reveal only THAT
// host's bound demon (its revealsId); otherwise (or if that foe binds nothing) reveal all hidden.
function revealDemons(c: CombatState, viaHostId?: CombatantId): CombatStep {
  const onlyId = viaHostId ? getC(c, viaHostId)?.revealsId : undefined
  const events: GameEvent[] = []
  let combat = c
  let enemyOrder = [...c.enemyOrder]
  for (const id of Object.keys(c.combatants)) {
    const x = c.combatants[id]!
    if (x.faction === 'enemy' && x.hidden && x.alive && (onlyId === undefined || id === onlyId)) {
      combat = withCombatant(combat, id, (e) => ({ ...e, hidden: false }))
      if (!enemyOrder.includes(id)) enemyOrder = [...enemyOrder, id]
      events.push({ type: 'demonRevealed', id })
    }
  }
  return step({ ...combat, enemyOrder, demonsRevealed: true }, events)
}

// =========================================================================================
//  PUBLIC: build + the FSM transitions
// =========================================================================================

export interface CombatInit {
  rng: RngState
  party: Combatant[]
  enemies: Combatant[]
  deck: CardInstance[]
  cardDefs: Record<string, CardDef>
  energyMax: number
  graceMax: number
  formation?: FormationLayout
  flags: CombatFlags
  winCondition: WinCondition
  nodeId: string
  encounterId: string
  rewardOptions?: RewardOption[]
  rewardXp?: number
  battleBg?: string
  rewardBg?: string
}

export function startCombat(init: CombatInit): CombatStep {
  const combatants: Record<CombatantId, Combatant> = {}
  for (const m of [...init.party, ...init.enemies]) combatants[m.id] = m

  const [deck, rng] = shuffle(init.rng, init.deck)

  let combat: CombatState = {
    rng,
    phase: 'combatStart',
    roundNumber: 0,
    turnOwner: { kind: 'party' },
    formation: init.formation ?? 'partyLeft_enemyRight',
    combatants,
    partyOrder: init.party.map((m) => m.id),
    enemyOrder: init.enemies.filter((e) => !e.hidden).map((e) => e.id),
    drawPile: deck,
    hand: [],
    discardPile: [],
    exhaustPile: [],
    energy: { current: 0, max: init.energyMax },
    grace: { current: init.graceMax, max: init.graceMax },
    roundActionTaken: false,
    cardsPlayedThisTurn: 0,
    firstAttackUsedThisTurn: false,
    shieldUsedThisRound: [],
    flags: init.flags,
    winCondition: init.winCondition,
    outcome: 'ongoing',
    humansKilled: 0,
    demonsRevealed: false,
    nextIid: init.deck.length,
    cardDefs: init.cardDefs,
    battleBg: init.battleBg,
    rewardBg: init.rewardBg,
    nodeId: init.nodeId,
    encounterId: init.encounterId,
    reward: undefined,
    rewardSpec: {
      options: init.rewardOptions ?? [{ id: 'money', kind: 'money', amount: 25 }],
      xp: init.rewardXp ?? 10,
    },
  }

  const events: GameEvent[] = [{ type: 'combatStarted', encounterId: init.encounterId }]
  const r = beginRound(combat)
  combat = r.combat
  events.push(...r.events)
  return step(combat, events)
}

function beginRound(c: CombatState): CombatStep {
  const round = c.roundNumber + 1
  let combat: CombatState = { ...c, roundNumber: round, roundActionTaken: false, shieldUsedThisRound: [], phase: 'roundStart' }

  // reset party block + tick down the Divine Protection shield (expires at 0 turns)
  for (const id of combat.partyOrder) {
    combat = withCombatant(combat, id, (x) => {
      const shield = x.shield && x.shield.turns > 1 ? { ...x.shield, turns: x.shield.turns - 1 } : undefined
      return { ...x, block: 0, shield }
    })
  }

  // fire onRoundStart powers (Breastplate block, Belt of Truth weaken, Steadfast/Zeal strength) AFTER
  // the block reset, so power-granted block survives into the action phase.
  const roundStart = firePartyPowers(combat, 'onRoundStart')
  combat = roundStart.combat
  const events: GameEvent[] = [{ type: 'roundAdvanced', round }, ...roundStart.events]
  const spiritEvents: SpiritEvent[] = [...roundStart.spiritEvents]

  // enemy auras (Aegis line-screen, War-Leader rally) fire each round while their holder lives. Enemy
  // block is NOT reset at round start (only the party's is), so ally block stands through the party's
  // upcoming attack — the screen is up exactly when the party would hit. Mirrors firePartyPowers.
  const enemyStart = fireEnemyPowers(combat, 'onRoundStart')
  combat = enemyStart.combat
  events.push(...enemyStart.events)
  spiritEvents.push(...enemyStart.spiritEvents)

  // telegraph enemy intents (+ which party member each targeting intent will strike, so the telegraph
  // matches execution and co-op players can see who is in danger). Solo (or one survivor) keeps [0] and
  // consumes no entropy → single-player byte-identical; co-op spreads via a forked sub-stream.
  for (const id of combat.enemyOrder) {
    const e = combat.combatants[id]!
    if (!e.alive || e.hidden) continue
    const intent = pickIntent(e, { round })
    let intentTargetId: CombatantId | undefined
    if (intent.kind === 'attack' || intent.kind === 'attackMulti' || intent.kind === 'debuff' || intent.kind === 'clutter') {
      const alive = aliveParty(combat)
      const tgt = alive.length > 1 ? (pick(fork(combat.rng, `tgt:${round}:${id}`), alive)[0] ?? alive[0]) : alive[0]
      intentTargetId = tgt?.id
    }
    combat = withCombatant(combat, id, (x) => ({ ...x, intent, intentTargetId }))
    events.push({ type: 'intentTelegraphed', id })
  }

  combat = { ...combat, phase: 'partyDecision' }
  return step(combat, events, spiritEvents)
}

function beginAction(c: CombatState): CombatStep {
  if (c.phase !== 'partyDecision') return reject(c, 'not-decision-phase')
  // reset per-turn power counters (Helmet card-count, Gospel-Shod first-attack gate)
  let combat: CombatState = { ...c, phase: 'partyAction', energy: { ...c.energy, current: c.energy.max }, cardsPlayedThisTurn: 0, firstAttackUsedThisTurn: false }
  const evs: GameEvent[] = [{ type: 'energyChanged', current: combat.energy.current, max: combat.energy.max }]
  const drawn = drawCards(combat, HAND_SIZE)
  combat = drawn.combat
  evs.push(...drawn.events)
  return step(combat, evs)
}

export function ensureActing(c: CombatState): CombatStep {
  // Auto-begin the action phase if the player starts acting from the decision window.
  return c.phase === 'partyDecision' ? beginAction(c) : step(c)
}

export function reposition(c: CombatState, moves: Array<{ id: CombatantId; row?: Row; side?: Side }>): CombatStep {
  if (c.phase !== 'partyDecision' || c.roundActionTaken) return reject(c, 'reposition-not-allowed')
  let combat = c
  for (const m of moves) {
    if (combat.combatants[m.id]?.faction !== 'party') continue
    combat = withCombatant(combat, m.id, (x) => ({ ...x, row: m.row ?? x.row, side: m.side ?? x.side }))
  }
  // Committing a reposition ENDS the round (costs the whole turn): skip straight to the enemy turn.
  combat = { ...combat, roundActionTaken: true }
  const after = enemyPhase(combat)
  return step(after.combat, [{ type: 'repositioned', turnSpent: true }, ...after.events], after.spiritEvents)
}

export function flee(c: CombatState): CombatStep {
  // allowed during the decision window AND once you're acting (auto-begin draws the hand) — either
  // way fleeing forfeits the turn, so any cards already drawn are discarded.
  if ((c.phase !== 'partyDecision' && c.phase !== 'partyAction') || c.roundActionTaken) return reject(c, 'flee-not-allowed')
  if (c.flags.mandatory || !c.flags.allowFlee) return reject(c, 'flee-forbidden')
  const base: CombatState = c.hand.length ? { ...c, discardPile: [...c.discardPile, ...c.hand], hand: [] } : c

  const fleeRng = fork(base.rng, `flee:${base.roundNumber}`)
  const speed = aliveParty(base).reduce((s, m) => s + m.stats.speed, 0)
  const probability = Math.min(0.9, 0.4 + speed * 0.01)
  const [roll] = nextFloat(fleeRng)
  const success = roll < probability

  if (success) {
    return step({ ...base, outcome: 'fled', phase: 'combatEnd' }, [
      { type: 'fleeAttempt', success: true },
      { type: 'combatEnded', outcome: 'fled' },
    ])
  }
  // failed flee still costs the turn
  const after = enemyPhase({ ...base, roundActionTaken: true })
  return step(after.combat, [{ type: 'fleeAttempt', success: false }, ...after.events], after.spiritEvents)
}

export function playCard(c: CombatState, iid: string, chosenId: CombatantId | undefined, spirit: number, cardTargetIids: string[] = [], actorMemberId?: string): CombatStep {
  const begun = ensureActing(c)
  let combat = begun.combat
  const preEvents = begun.events
  if (combat.phase !== 'partyAction') return reject(c, 'not-action-phase')

  const inst = combat.hand.find((x) => x.iid === iid)
  if (!inst) return reject(c, 'card-not-in-hand')
  const def = cardDef(combat, inst)
  if (!def) return reject(c, 'unknown-card')
  if (def.unplayable) return reject(c, 'card-unplayable')

  const cost = inst.costOverride ?? def.cost
  if (combat.energy.current < cost) return reject(c, 'not-enough-energy')

  // pay + move to discard (or exhaust)
  combat = {
    ...combat,
    energy: { ...combat.energy, current: combat.energy.current - cost },
    hand: combat.hand.filter((x) => x.iid !== iid),
    roundActionTaken: true,
  }
  combat = def.exhaust
    ? { ...combat, exhaustPile: [...combat.exhaustPile, inst] }
    : { ...combat, discardPile: [...combat.discardPile, inst] }

  // A card acts on behalf of its OWNER: the source is the card's owner, so `self` effects (guard/heal)
  // land on the owner and the owner's scale/statuses apply — regardless of which player played it from
  // the shared co-op hand. (Anyone may play any card, but "play B's Guard" shields B.) `actorMemberId`
  // is attribution-only (who clicked); it does NOT change the source. Single-player: owner == the hero.
  void actorMemberId
  const sourceId = sourceForCard(combat, inst.ownerId)
  const events: GameEvent[] = [
    ...preEvents,
    { type: 'cardPlayed', iid, defId: def.id },
    { type: 'energyChanged', current: combat.energy.current, max: combat.energy.max },
  ]
  const spiritEvents: SpiritEvent[] = []
  if (def.layer === 'spirit' && def.type !== 'verse') spiritEvents.push({ kind: 'playSpiritualCard' })
  if (def.type === 'verse') spiritEvents.push({ kind: 'playVerseCard' })

  for (const op of def.effects) {
    const r = applyEffect(combat, op, sourceId, chosenId, def.target, spirit, def, cardTargetIids)
    combat = r.combat
    // stamp the played iid onto fizzle events
    events.push(...r.events.map((e) => (e.type === 'cardFizzled' ? { ...e, iid } : e)))
    spiritEvents.push(...r.spiritEvents)
  }

  // power triggers: count this card, then fire onCardPlayed (Helmet draw) and, for attacks,
  // onAttackPlayed (Gospel-Shod energy) before sealing the gate. Uses the RESOLVED def's type.
  combat = { ...combat, cardsPlayedThisTurn: combat.cardsPlayedThisTurn + 1 }
  const onPlayed = firePartyPowers(combat, 'onCardPlayed')
  combat = onPlayed.combat
  events.push(...onPlayed.events)
  spiritEvents.push(...onPlayed.spiritEvents)
  if (def.type === 'attack') {
    const onAttack = firePartyPowers(combat, 'onAttackPlayed')
    combat = onAttack.combat
    events.push(...onAttack.events)
    spiritEvents.push(...onAttack.spiritEvents)
    combat = { ...combat, firstAttackUsedThisTurn: true }
  }

  const ended = finalizeIfEnded(combat)
  return step(ended.combat, [...events, ...ended.events], [...spiritEvents, ...ended.spiritEvents])
}

/** The combatant that "casts" a party card: its contributing member (back-row/attack/affinity). */
function sourceForCard(c: CombatState, ownerMemberId: string): CombatantId {
  const owner = c.partyOrder.find((id) => c.combatants[id]?.memberId === ownerMemberId && c.combatants[id]?.alive)
  return owner ?? c.partyOrder.find((id) => c.combatants[id]?.alive) ?? c.partyOrder[0]!
}

export function useGrace(c: CombatState, ability: GraceAbilityId, chosenId: CombatantId | undefined, spirit: number): CombatStep {
  void spirit
  const meta = getGrace(ability)
  if (!meta) return reject(c, 'unknown-grace')
  // hero must possess the ability
  const hero = c.partyOrder.map((id) => c.combatants[id]!).find((x) => x.graceAbilityIds?.includes(ability))
  if (!hero) return reject(c, 'grace-not-owned')
  if (c.grace.current < meta.costGrace) return reject(c, 'not-enough-grace')

  const begun = ensureActing(c)
  let combat = begun.combat
  const events: GameEvent[] = [...begun.events]
  const spiritEvents: SpiritEvent[] = [{ kind: 'useGrace', ability }]

  combat = {
    ...combat,
    grace: { ...combat.grace, current: combat.grace.current - meta.costGrace },
    roundActionTaken: true,
  }
  events.push({ type: 'graceUsed', ability, targetId: chosenId })
  events.push({ type: 'graceChanged', current: combat.grace.current, max: combat.grace.max })

  if (ability === 'mercy') {
    const target = chosenId ? getC(combat, chosenId) : undefined
    if (!target || target.faction !== 'enemy' || !target.isHuman || !target.alive) {
      return reject(c, 'mercy-needs-living-human')
    }
    const death = killCombatant(combat, chosenId!, /* viaMercy */ true)
    combat = death.combat
    events.push(...death.events)
    spiritEvents.push(...death.spiritEvents)
  }

  const ended = finalizeIfEnded(combat)
  return step(ended.combat, [...events, ...ended.events], [...spiritEvents, ...ended.spiritEvents])
}

/**
 * Use a bag item in combat. The item is wrapped in a synthetic flesh "card" so its `effects` flow
 * through the EXACT same interpreter as cards (heal/damage/block/status/…) — there is no parallel
 * effect system. Using an item is FREE: it pays no energy and does NOT set `roundActionTaken`, so it
 * never costs the turn. (Flip the commented `roundActionTaken` line to make item-use cost the turn.)
 * Does NOT touch the inventory — the run-aware combat reducer validates the stack and decrements.
 */
export function useItem(
  c: CombatState,
  item: ItemDef,
  sourceMemberId: MemberId,
  chosenId: CombatantId | undefined,
  spirit: number,
): CombatStep {
  if (!item.effects?.length) return reject(c, 'item-not-usable-in-combat')
  const begun = ensureActing(c)
  let combat = begun.combat
  if (combat.phase !== 'partyAction') return reject(c, 'not-action-phase')
  // combat = { ...combat, roundActionTaken: true } // ← uncomment to make item-use cost the turn

  const pseudoCard = itemPseudoCard(item)
  const sourceId = sourceForCard(combat, sourceMemberId)
  const events: GameEvent[] = [...begun.events]
  const spiritEvents: SpiritEvent[] = []
  for (const op of item.effects) {
    const r = applyEffect(combat, op, sourceId, chosenId, pseudoCard.target, spirit, pseudoCard)
    combat = r.combat
    events.push(...r.events)
    spiritEvents.push(...r.spiritEvents)
  }

  const ended = finalizeIfEnded(combat)
  return step(ended.combat, [...events, ...ended.events], [...spiritEvents, ...ended.spiritEvents])
}

// ---- enemy turn: shared building blocks (batch endTurn + UI-stepped advanceEnemyTurn) -----------

/** reset every enemy's block at the start of their turn */
function resetEnemyBlock(c: CombatState): CombatState {
  let combat = c
  for (const id of combat.enemyOrder) combat = withCombatant(combat, id, (x) => ({ ...x, block: 0 }))
  return combat
}

/** the enemies that act this turn, fastest first (alive + revealed) — snapshotted at turn start */
function buildEnemyOrder(c: CombatState): CombatantId[] {
  return [...c.enemyOrder]
    .map((id) => c.combatants[id]!)
    .filter((x) => x.alive && !x.hidden)
    .sort((a, b) => b.stats.speed - a.stats.speed)
    .map((x) => x.id)
}

/** round resolve: tick poison DoT (deals HP, may kill), then status durations, then end combat or
 *  begin the next round. tickDots runs FIRST and owns the poison lifecycle (tickStatuses skips it). */
function resolveRound(c: CombatState): CombatStep {
  const dot = tickDots(c)
  const combat = tickStatuses(dot.combat)
  const ended = finalizeIfEnded(combat)
  const events = [...dot.events, ...ended.events]
  const spiritEvents = [...dot.spiritEvents, ...ended.spiritEvents]
  if (ended.combat.outcome !== 'ongoing') return step(ended.combat, events, spiritEvents)
  const next = beginRound(ended.combat)
  return step(next.combat, [...events, ...next.events], [...spiritEvents, ...next.spiritEvents])
}

/** end the party's action phase: discard the hand → 'partyEnd' (shared by the batch + stepped paths) */
function endPartyTurn(c: CombatState): CombatStep {
  const begun = ensureActing(c)
  if (begun.combat.phase !== 'partyAction') return reject(c, 'not-action-phase')
  const combat: CombatState = { ...begun.combat, discardPile: [...begun.combat.discardPile, ...begun.combat.hand], hand: [], phase: 'partyEnd' }
  return step(combat, begun.events)
}

export function endTurn(c: CombatState, spirit: number): CombatStep {
  void spirit
  const ended = endPartyTurn(c)
  if (ended.events.some((e) => e.type === 'rejected')) return ended
  const after = enemyPhase(ended.combat)
  return step(after.combat, [...ended.events, ...after.events], after.spiritEvents)
}

/** BATCH enemy turn → round resolve → next round (or combat end). Used by tests / headless /
 *  reduced-motion. The interactive UI uses beginEnemyTurnFromParty + advanceEnemyTurn instead. */
function enemyPhase(c: CombatState): CombatStep {
  let combat = resetEnemyBlock({ ...c, phase: 'enemyTurn' })
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []

  for (const id of buildEnemyOrder(combat)) {
    if (!combat.combatants[id]?.alive) continue
    const r = executeIntent(combat, id)
    combat = r.combat
    events.push({ type: 'enemyActed', id }, ...r.events)
    spiritEvents.push(...r.spiritEvents)
    if (allPartyDead(combat)) break
  }

  const resolved = resolveRound(combat)
  return step(resolved.combat, [...events, ...resolved.events], [...spiritEvents, ...resolved.spiritEvents])
}

/** STEPPED enemy turn (UI-paced): begin the turn — end the party turn + queue the actors — without
 *  resolving any enemy action yet. The UI then drives advanceEnemyTurn one enemy at a time. */
export function beginEnemyTurnFromParty(c: CombatState): CombatStep {
  const ended = endPartyTurn(c)
  if (ended.events.some((e) => e.type === 'rejected')) return ended
  const combat = resetEnemyBlock({ ...ended.combat, phase: 'enemyTurn' })
  const queue = buildEnemyOrder(combat)
  return step(
    { ...combat, enemyQueue: queue, enemyStepIndex: 0, turnOwner: { kind: 'enemy', index: 0 } },
    [...ended.events, { type: 'enemyTurnBegan', count: queue.length }],
  )
}

/** STEPPED enemy turn: resolve the NEXT queued enemy; when the queue is spent (or the party is dead)
 *  run the round resolve and hand control back to the party. */
export function advanceEnemyTurn(c: CombatState): CombatStep {
  if (c.phase !== 'enemyTurn' || c.enemyQueue === undefined) return reject(c, 'not-enemy-turn')
  const queue = c.enemyQueue
  let idx = c.enemyStepIndex ?? 0
  while (idx < queue.length && !c.combatants[queue[idx]!]?.alive) idx++ // skip enemies killed earlier this turn

  if (idx >= queue.length || allPartyDead(c)) {
    const cleared: CombatState = { ...c, enemyQueue: undefined, enemyStepIndex: undefined, turnOwner: { kind: 'party' } }
    const resolved = resolveRound(cleared)
    return step(resolved.combat, [{ type: 'enemyTurnEnded' }, ...resolved.events], resolved.spiritEvents)
  }

  const id = queue[idx]!
  const r = executeIntent(c, id)
  const combat: CombatState = { ...r.combat, enemyStepIndex: idx + 1, turnOwner: { kind: 'enemy', index: idx + 1 } }
  return step(combat, [{ type: 'enemyActed', id }, ...r.events], r.spiritEvents)
}

function executeIntent(c: CombatState, enemyId: CombatantId): CombatStep {
  const e = c.combatants[enemyId]!
  const intent = e.intent ?? pickIntent(e, { round: c.roundNumber })

  // bound enemies skip their turn and lose a bound stack
  if (statusStacks(e, 'bound') > 0) {
    return step(withCombatant(c, enemyId, (x) => ({ ...x, statuses: x.statuses.map((s) => (s.id === 'bound' ? { ...s, stacks: s.stacks - 1 } : s)) })))
  }

  // Strike the member telegraphed at round start (so the shown target matches the hit). If that member
  // has since died, retarget: solo/one-survivor keeps the front member (no entropy → SP byte-identical),
  // co-op spreads via a forked sub-stream.
  const alive = aliveParty(c)
  const telegraphed = e.intentTargetId ? c.combatants[e.intentTargetId] : undefined
  const target =
    telegraphed && telegraphed.alive && telegraphed.faction === 'party'
      ? telegraphed
      : alive.length > 1
        ? pick(fork(c.rng, `tgt:${c.roundNumber}:${enemyId}`), alive)[0] ?? alive[0]
        : alive[0]
  if (!target) return step(c)

  switch (intent.kind) {
    case 'attack':
      return damageTarget(c, enemyId, target.id, intent.value ?? Math.max(1, e.stats.attack), { nonLethal: false })
    case 'attackMulti': {
      let combat = c
      const events: GameEvent[] = []
      const spiritEvents: SpiritEvent[] = []
      for (let i = 0; i < (intent.hits ?? 1); i++) {
        const r = damageTarget(combat, enemyId, target.id, intent.value ?? 1, { nonLethal: false })
        combat = r.combat
        events.push(...r.events)
        spiritEvents.push(...r.spiritEvents)
        if (allPartyDead(combat)) break
      }
      return step(combat, events, spiritEvents)
    }
    case 'block':
      return step(withCombatant(c, enemyId, (x) => ({ ...x, block: x.block + (intent.value ?? 0) })))
    case 'buff':
      // self-buff (e.g. gain Strength); persists like card-applied strength
      return step(applyStatusTo(c, enemyId, intent.status ?? 'strength', intent.stacks ?? 1))
    case 'debuff':
      // afflict the front party member (weak/vulnerable)
      return step(applyStatusTo(c, target.id, intent.status ?? 'weak', intent.stacks ?? 1))
    case 'clutter':
      // sow unplayable clutter into the party's discard pile (it reshuffles in and clogs the deck).
      // The cards carry a living member's id so death-purge stays consistent.
      return injectCards(c, 'spike', intent.value ?? 1, 'discard', target.memberId ?? target.id)
    default:
      return step(c)
  }
}

/** Poison (and any future DoT): deal stacks×scale unblocked HP to each afflicted combatant, then spend
 *  one stack. Bypasses block + the physical pipeline (fromDot); a lethal tick routes through
 *  damageTarget→killCombatant, so poisoning a human to death still griefs Spirit. Self-sourced (the
 *  source's stats are irrelevant — fromDot skips physicalAmount). */
function tickDots(c: CombatState): CombatStep {
  let combat = c
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []
  for (const id of Object.keys(combat.combatants)) {
    const x = combat.combatants[id]
    if (!x || !x.alive) continue
    const poison = statusStacks(x, 'poison')
    if (poison <= 0) continue
    const r = damageTarget(combat, id, id, poison * x.scale, { nonLethal: false, fromDot: true })
    combat = r.combat
    events.push(...r.events)
    spiritEvents.push(...r.spiritEvents)
    // spend one poison stack (harmless if the target died this tick)
    combat = withCombatant(combat, id, (t) => ({
      ...t,
      statuses: t.statuses.map((s) => (s.id === 'poison' ? { ...s, stacks: s.stacks - 1 } : s)).filter((s) => s.stacks > 0),
    }))
  }
  return step(combat, events, spiritEvents)
}

function tickStatuses(c: CombatState): CombatState {
  let combat = c
  for (const id of Object.keys(combat.combatants)) {
    combat = withCombatant(combat, id, (x) => {
      if (!x.alive) return x
      const statuses = x.statuses
        // strength/dexterity/lastStand persist; poison is owned by tickDots (skip it here); the rest count down
        .map((s) => (s.id === 'strength' || s.id === 'dexterity' || s.id === 'lastStand' || s.id === 'poison' ? s : { ...s, stacks: s.stacks - 1 }))
        .filter((s) => s.stacks > 0)
      return { ...x, statuses }
    })
  }
  return combat
}

const allPartyDead = (c: CombatState): boolean => aliveParty(c).length === 0

// ---- win / defeat resolution ------------------------------------------------------------

function finalizeIfEnded(c: CombatState): CombatStep {
  if (c.outcome !== 'ongoing') return step(c)

  if (allPartyDead(c)) {
    return step({ ...c, outcome: 'defeat', phase: 'combatEnd' }, [{ type: 'combatEnded', outcome: 'defeat' }])
  }

  let combat = c
  const win = isWon(combat)
  if (!win.won) return refreshLastStand(combat) // combat continues: a lone surviving foe may now rally

  // demons bound to a dead human flee (brute path)
  combat = fleeBoundDemons(combat)

  const peaceful = combat.humansKilled === 0
  const outcome = peaceful ? 'peaceful' : 'victory'
  combat = { ...combat, outcome, phase: 'combatEnd', reward: buildReward(combat, peaceful) }
  return step(combat, [{ type: 'combatEnded', outcome }, { type: 'rewardOffered' }])
}

function isWon(c: CombatState): { won: boolean } {
  switch (c.winCondition.kind) {
    case 'allEnemiesDefeated':
      return { won: Object.values(c.combatants).every((x) => x.faction !== 'enemy' || !x.alive) }
    case 'allDemonsDestroyed': {
      const demons = aliveDemons(c)
      if (demons.length === 0) return { won: true }
      // brute path: a demon BOUND to a human host flees when that host dies (see fleeBoundDemons). So
      // if every surviving demon is bound AND no human enemies remain, they all flee → win. A lone
      // UNBOUND demon (e.g. a Spirit of Dread) has no host to lose and must actually be destroyed —
      // without the bound check a humanless demon fight "wins" itself the moment this check first runs.
      if (demons.every((d) => d.boundToId != null) && aliveHumanEnemies(c).length === 0) return { won: true }
      return { won: false }
    }
    case 'survive':
      return { won: c.roundNumber >= c.winCondition.rounds }
  }
}

/** A demon whose host human is dead flees the field (used by the brute path). */
function fleeBoundDemons(c: CombatState): CombatState {
  let combat = c
  for (const d of aliveDemons(combat)) {
    const host = d.boundToId ? combat.combatants[d.boundToId] : undefined
    if (d.boundToId && (!host || !host.alive)) {
      combat = withCombatant(combat, d.id, (x) => ({ ...x, alive: false, hp: 0 }))
    }
  }
  return combat
}

function buildReward(c: CombatState, peaceful: boolean): RewardChoice {
  const xpByMember: Record<string, number> = {}
  for (const id of c.partyOrder) {
    const m = c.combatants[id]!
    if (m.alive && m.memberId) xpByMember[m.memberId] = c.rewardSpec.xp
  }
  // Spoils are each individually claimable. cardOptions stays undefined here — it is sampled from the
  // hero's pool in the run-aware layer (combat/reduce applyStep), which has run.rng + the profile.
  return {
    xpByMember,
    spoils: c.rewardSpec.options.map((o) => ({ ...o, claimed: false })),
    cardResolved: false,
    peacefulSpiritBonus: peaceful ? 20 : undefined,
    righteous: peaceful,
  }
}
