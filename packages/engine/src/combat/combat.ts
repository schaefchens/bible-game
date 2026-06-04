// The combat engine core: pure functions over CombatState. Each player action returns a
// CombatStep { combat, events, spiritEvents }. Spirit is NOT mutated here — combat emits
// SpiritEvent intents that the combat reducer applies to run.spirit (single-writer rule), and
// reads the current spirit scalar (passed in) only to scale spiritual effects via potencyMult.

import type { CardDef, CardInstance, EffectOp, StatusId, TargetKind } from '../cards/types'
import type { GameEvent } from '../events/event'
import { getGrace } from '../grace/grace'
import { scaleSpiritValue } from '../spirit/spirit'
import type { SpiritEvent } from '../spirit/spirit'
import { fork, nextFloat, shuffle, type RngState } from '../rng/rng'
import type { CombatantId, GraceAbilityId } from '../types'
import { pickIntent } from './ai'
import { absorb, physicalAmount, spiritualAmount, statusStacks } from './damage'
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

function cardDef(c: CombatState, inst: CardInstance): CardDef | undefined {
  return c.cardDefs[inst.defId]
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

/** Apply raw damage of a type to a target: block/ward absorption, HP, and death routing. */
function damageTarget(
  c: CombatState,
  sourceId: CombatantId,
  targetId: CombatantId,
  rawBase: number,
  damageType: 'physical' | 'spiritual',
  opts: { nonLethal: boolean },
): CombatStep {
  const source = getC(c, sourceId)
  const target = getC(c, targetId)
  if (!source || !target || !target.alive) return step(c)

  const hit =
    damageType === 'physical' ? physicalAmount(rawBase, source, target) : spiritualAmount(rawBase, target)

  const pool = damageType === 'physical' ? target.block : target.spiritualBlock
  const split = absorb(hit.amount, pool)

  const hp = target.hp - split.hpDamage
  const events: GameEvent[] = [
    { type: 'damageDealt', targetId, amount: split.hpDamage, damageType, blocked: split.blocked, capped: hit.capped },
  ]
  const spiritEvents: SpiritEvent[] = []

  // Non-lethal vs humans: never drops below 1; instead subdues.
  const lethal = hp <= 0
  const subdue = lethal && opts.nonLethal && target.isHuman

  let next: Combatant = {
    ...target,
    hp: subdue ? 1 : Math.max(0, hp),
    block: damageType === 'physical' ? split.remainingBlock : target.block,
    spiritualBlock: damageType === 'spiritual' ? split.remainingBlock : target.spiritualBlock,
  }

  let outCombat = { ...c, combatants: { ...c.combatants, [targetId]: next } }

  if (subdue) {
    next = { ...next, alive: false }
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
  let out = withCombatant(c, id, (x) => ({ ...x, alive: false, hp: 0 }))
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

/** Resolve a single EffectOp. `spirit` scales spirit-layer ops via potencyMult. */
function applyEffect(
  c: CombatState,
  op: EffectOp,
  sourceId: CombatantId,
  chosenId: CombatantId | undefined,
  defaultTarget: TargetKind,
  spirit: number,
  card: CardDef,
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
      const isSpiritual = op.damageType === 'spiritual'
      let base: number
      if (isSpiritual) {
        base = scaleSpiritValue(op.amount, spirit, { affinity: source.stats.spiritAffinity })
        if (base <= 0) {
          return step(combat, [{ type: 'cardFizzled', iid: '', defId: card.id, reason: 'lowSpirit' }])
        }
      } else {
        base = op.amount + source.stats.attack
      }
      for (const tid of targets) {
        for (let h = 0; h < hits; h++) {
          const r = damageTarget(combat, sourceId, tid, base, op.damageType, {
            nonLethal: card.nonLethal ?? false,
          })
          combat = r.combat
          events.push(...r.events)
          spiritEvents.push(...r.spiritEvents)
        }
      }
      return step(combat, events, spiritEvents)
    }
    case 'block': {
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      const spiritual = op.layer === 'spirit'
      const amount = spiritual ? scaleSpiritValue(op.amount, spirit, { affinity: source.stats.spiritAffinity, floor: 1 }) : op.amount
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) =>
          spiritual ? { ...x, spiritualBlock: x.spiritualBlock + amount } : { ...x, block: x.block + amount },
        )
        events.push({ type: 'blockGained', targetId: tid, amount, spiritual })
      }
      return step(combat, events)
    }
    case 'heal': {
      const targets = resolveTargets(combat, sourceId, op.target ?? 'self', chosenId)
      for (const tid of targets) {
        combat = withCombatant(combat, tid, (x) => ({ ...x, hp: Math.min(x.maxHp, x.hp + op.amount) }))
        events.push({ type: 'healed', targetId: tid, amount: op.amount })
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
      return revealDemons(combat)
    }
    case 'scaleBySpirit': {
      // wrapper: scale the inner op's magnitude by potency (only damage/heal/block carry amounts)
      const scaled = scaleSpiritValue(
        'amount' in op.base ? op.base.amount : 0,
        spirit,
        { affinity: source.stats.spiritAffinity, floor: op.floor },
      )
      const inner = { ...op.base, amount: scaled } as EffectOp
      if ('amount' in inner && inner.amount <= 0) {
        return step(combat, [{ type: 'cardFizzled', iid: '', defId: card.id, reason: 'lowSpirit' }])
      }
      return applyEffect(combat, inner, sourceId, chosenId, defaultTarget, /* already scaled */ 200, card)
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

function revealDemons(c: CombatState): CombatStep {
  const events: GameEvent[] = []
  let combat = c
  let enemyOrder = [...c.enemyOrder]
  for (const id of Object.keys(c.combatants)) {
    const x = c.combatants[id]!
    if (x.faction === 'enemy' && x.hidden && x.alive) {
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

  // reset party block/ward + tick start-of-turn party statuses (none in M1)
  for (const id of combat.partyOrder) {
    combat = withCombatant(combat, id, (x) => ({ ...x, block: 0, spiritualBlock: 0 }))
  }

  // telegraph enemy intents
  const events: GameEvent[] = [{ type: 'roundAdvanced', round }]
  for (const id of combat.enemyOrder) {
    const e = combat.combatants[id]!
    if (!e.alive || e.hidden) continue
    combat = withCombatant(combat, id, (x) => ({ ...x, intent: pickIntent(x) }))
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
  if (c.phase !== 'partyDecision' || c.roundActionTaken) return reject(c, 'flee-not-allowed')
  if (c.flags.mandatory || !c.flags.allowFlee) return reject(c, 'flee-forbidden')

  const fleeRng = fork(c.rng, `flee:${c.roundNumber}`)
  const speed = aliveParty(c).reduce((s, m) => s + m.stats.speed, 0)
  const probability = Math.min(0.9, 0.4 + speed * 0.01)
  const [roll] = nextFloat(fleeRng)
  const success = roll < probability

  if (success) {
    return step({ ...c, outcome: 'fled', phase: 'combatEnd' }, [
      { type: 'fleeAttempt', success: true },
      { type: 'combatEnded', outcome: 'fled' },
    ])
  }
  // failed flee still costs the turn
  const after = enemyPhase({ ...c, roundActionTaken: true })
  return step(after.combat, [{ type: 'fleeAttempt', success: false }, ...after.events], after.spiritEvents)
}

export function playCard(c: CombatState, iid: string, chosenId: CombatantId | undefined, spirit: number): CombatStep {
  const begun = ensureActing(c)
  let combat = begun.combat
  const preEvents = begun.events
  if (combat.phase !== 'partyAction') return reject(c, 'not-action-phase')

  const inst = combat.hand.find((x) => x.iid === iid)
  if (!inst) return reject(c, 'card-not-in-hand')
  const def = cardDef(combat, inst)
  if (!def) return reject(c, 'unknown-card')

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
    const r = applyEffect(combat, op, sourceId, chosenId, def.target, spirit, def)
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

  if (ability === 'sight') {
    const r = revealDemons(combat)
    combat = r.combat
    events.push(...r.events)
  } else if (ability === 'mercy') {
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

export function endTurn(c: CombatState, spirit: number): CombatStep {
  void spirit
  const begun = ensureActing(c)
  let combat = begun.combat
  if (combat.phase !== 'partyAction') return reject(c, 'not-action-phase')

  // discard hand
  combat = { ...combat, discardPile: [...combat.discardPile, ...combat.hand], hand: [], phase: 'partyEnd' }

  const after = enemyPhase(combat)
  return step(after.combat, [...begun.events, ...after.events], after.spiritEvents)
}

/** Enemy turn → round resolve → next round (or combat end). */
function enemyPhase(c: CombatState): CombatStep {
  let combat: CombatState = { ...c, phase: 'enemyTurn' }
  const events: GameEvent[] = []
  const spiritEvents: SpiritEvent[] = []

  // reset enemy block at the start of their turn
  for (const id of combat.enemyOrder) combat = withCombatant(combat, id, (x) => ({ ...x, block: 0, spiritualBlock: 0 }))

  const order = [...combat.enemyOrder]
    .map((id) => combat.combatants[id]!)
    .filter((x) => x.alive && !x.hidden)
    .sort((a, b) => b.stats.speed - a.stats.speed)

  for (const e of order) {
    const cur = combat.combatants[e.id]!
    if (!cur.alive) continue
    const r = executeIntent(combat, e.id)
    combat = r.combat
    events.push({ type: 'enemyActed', id: e.id }, ...r.events)
    spiritEvents.push(...r.spiritEvents)
    if (allPartyDead(combat)) break
  }

  // round resolve: tick durations
  combat = tickStatuses(combat)
  const ended = finalizeIfEnded(combat)
  if (ended.combat.outcome !== 'ongoing') {
    return step(ended.combat, [...events, ...ended.events], [...spiritEvents, ...ended.spiritEvents])
  }
  const next = beginRound(ended.combat)
  return step(next.combat, [...events, ...next.events], spiritEvents)
}

function executeIntent(c: CombatState, enemyId: CombatantId): CombatStep {
  const e = c.combatants[enemyId]!
  const intent = e.intent ?? pickIntent(e)

  // bound enemies skip their turn and lose a bound stack
  if (statusStacks(e, 'bound') > 0) {
    return step(withCombatant(c, enemyId, (x) => ({ ...x, statuses: x.statuses.map((s) => (s.id === 'bound' ? { ...s, stacks: s.stacks - 1 } : s)) })))
  }

  const target = aliveParty(c)[0]
  if (!target) return step(c)

  switch (intent.kind) {
    case 'attack':
      return damageTarget(c, enemyId, target.id, intent.value ?? Math.max(1, e.stats.attack), 'physical', { nonLethal: false })
    case 'attackMulti': {
      let combat = c
      const events: GameEvent[] = []
      const spiritEvents: SpiritEvent[] = []
      for (let i = 0; i < (intent.hits ?? 1); i++) {
        const r = damageTarget(combat, enemyId, target.id, intent.value ?? 1, 'physical', { nonLethal: false })
        combat = r.combat
        events.push(...r.events)
        spiritEvents.push(...r.spiritEvents)
        if (allPartyDead(combat)) break
      }
      return step(combat, events, spiritEvents)
    }
    case 'dread':
      return damageTarget(c, enemyId, target.id, intent.value ?? e.dread ?? 0, 'spiritual', { nonLethal: false })
    case 'block':
      return step(withCombatant(c, enemyId, (x) => ({ ...x, block: x.block + (intent.value ?? 0) })))
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
        .map((s) => (s.id === 'strength' ? s : { ...s, stacks: s.stacks - 1 }))
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
  if (!win.won) return step(combat)

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
  return {
    xpByMember,
    options: c.rewardSpec.options,
    peacefulSpiritBonus: peaceful ? 20 : undefined,
    righteous: peaceful,
  }
}
