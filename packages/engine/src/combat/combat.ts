// The combat engine core: pure functions over CombatState. Each player action returns a
// CombatStep { combat, events, spiritEvents }. Spirit is NOT mutated here — combat emits
// SpiritEvent intents that the combat reducer applies to run.spirit (single-writer rule), and
// reads the current spirit scalar (passed in) only to scale spiritual effects via potencyMult.

import type { CardDef, CardInstance, EffectOp, StatusId, TargetKind } from '../cards/types'
import { itemPseudoCard, type ItemDef } from '../inventory/types'
import type { GameEvent } from '../events/event'
import { getGrace } from '../grace/grace'
import { miracleChance, scaleSpiritValue } from '../spirit/spirit'
import type { SpiritEvent } from '../spirit/spirit'
import { chance, fork, nextFloat, pick, shuffle, type RngState } from '../rng/rng'
import type { CardDefId, CombatantId, GraceAbilityId, MemberId } from '../types'
import { pickIntent } from './ai'
import { absorb, physicalAmount, statusStacks } from './damage'
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

function resolveTargets(
  c: CombatState,
  sourceId: CombatantId,
  target: TargetKind,
  chosenId: CombatantId | undefined,
): CombatantId[] {
  switch (target) {
    case 'self':
      return [sourceId]
    case 'allAllies':
      return aliveParty(c).map((x) => x.id)
    case 'allEnemies':
      return targetableEnemies(c).map((x) => x.id)
    case 'ally': {
      const id = chosenId && getC(c, chosenId)?.faction === 'party' ? chosenId : sourceId
      return [id]
    }
    case 'enemy': {
      const chosen = chosenId ? getC(c, chosenId) : undefined
      if (chosen && chosen.faction === 'enemy' && chosen.alive && !chosen.hidden) return [chosenId!]
      const first = targetableEnemies(c)[0]
      return first ? [first.id] : []
    }
    case 'none':
      return []
  }
}

/** Apply raw damage to a target: block absorption, Divine Protection, HP, and death routing. */
function damageTarget(
  c: CombatState,
  sourceId: CombatantId,
  targetId: CombatantId,
  rawBase: number,
  opts: { nonLethal: boolean },
): CombatStep {
  const source = getC(c, sourceId)
  const target = getC(c, targetId)
  if (!source || !target || !target.alive) return step(c)

  const hit = physicalAmount(rawBase, source, target)
  const split = absorb(hit.amount, target.block)

  let hpDamage = split.hpDamage
  let rng = c.rng
  const events: GameEvent[] = []
  // Divine Protection miracle: a successful Spirit-scaled roll caps this hit at 1 (party only).
  if (target.faction === 'party' && target.shield && hpDamage > 1) {
    const [negate, ns] = chance(rng, target.shield.chance)
    rng = ns
    if (negate) {
      hpDamage = 1
      events.push({ type: 'shieldNegated', targetId })
    }
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
      const base = spiritScaled(card, op.amount, spirit, source.scale)
      if (base <= 0) return step(combat, [{ type: 'cardFizzled', iid: '', defId: card.id, reason: 'lowSpirit' }])
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
      const amount = spiritScaled(card, op.amount, spirit, source.scale, { floor: 1 })
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) => ({ ...x, block: x.block + amount }))
        events.push({ type: 'blockGained', targetId: tid, amount })
      }
      return step(combat, events)
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
      // Temporarily upgrade up to `count` chosen cards to their `+` form for the rest of the battle.
      // Only cards with an `upgradeTo` (and not already honed) qualify — re-honing is a no-op because
      // a honed copy resolves to a `+` def, which has no further `upgradeTo`.
      const honed: string[] = []
      for (const tid of cardTargetIids.slice(0, op.count)) {
        const inst = findInstance(combat, tid)
        if (!inst || inst.honedDefId) continue
        const toId = combat.cardDefs[inst.defId]?.upgradeTo
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
  let combat: CombatState = { ...c, roundNumber: round, roundActionTaken: false, phase: 'roundStart' }

  // reset party block + tick down the Divine Protection shield (expires at 0 turns)
  for (const id of combat.partyOrder) {
    combat = withCombatant(combat, id, (x) => {
      const shield = x.shield && x.shield.turns > 1 ? { ...x.shield, turns: x.shield.turns - 1 } : undefined
      return { ...x, block: 0, shield }
    })
  }

  // telegraph enemy intents
  const events: GameEvent[] = [{ type: 'roundAdvanced', round }]
  for (const id of combat.enemyOrder) {
    const e = combat.combatants[id]!
    if (!e.alive || e.hidden) continue
    combat = withCombatant(combat, id, (x) => ({ ...x, intent: pickIntent(x, { round }) }))
    events.push({ type: 'intentTelegraphed', id })
  }

  combat = { ...combat, phase: 'partyDecision' }
  return step(combat, events)
}

function beginAction(c: CombatState): CombatStep {
  if (c.phase !== 'partyDecision') return reject(c, 'not-decision-phase')
  let combat: CombatState = { ...c, phase: 'partyAction', energy: { ...c.energy, current: c.energy.max } }
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

export function playCard(c: CombatState, iid: string, chosenId: CombatantId | undefined, spirit: number, cardTargetIids: string[] = []): CombatStep {
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

/** round resolve: tick status durations, then end combat or begin the next round */
function resolveRound(c: CombatState): CombatStep {
  const combat = tickStatuses(c)
  const ended = finalizeIfEnded(combat)
  if (ended.combat.outcome !== 'ongoing') return ended
  return beginRound(ended.combat)
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

  const target = aliveParty(c)[0]
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

function tickStatuses(c: CombatState): CombatState {
  let combat = c
  for (const id of Object.keys(combat.combatants)) {
    combat = withCombatant(combat, id, (x) => {
      if (!x.alive) return x
      const statuses = x.statuses
        // strength + lastStand persist (no per-round decay); the rest count down
        .map((s) => (s.id === 'strength' || s.id === 'lastStand' ? s : { ...s, stacks: s.stacks - 1 }))
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
      if (aliveDemons(c).length === 0) return { won: true }
      // brute: no living humans left → bound demons lose their hosts and flee
      if (aliveHumanEnemies(c).length === 0) return { won: true }
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
