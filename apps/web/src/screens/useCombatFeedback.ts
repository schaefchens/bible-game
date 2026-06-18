import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { CombatState, GameEvent } from '@bible/engine'
import { useGame } from '../store/gameStore'

// Combat feedback (juice) derived from the engine's event stream. The store applies one dispatch
// synchronously and exposes the resulting (state, lastEvents, tick) snapshot — `state` is already the
// FINAL post-event state and `lastEvents` is the diff of what happened. We turn that diff into transient
// visual cues. The whole enemy turn arrives in ONE batch (enemyActed A, damage…, enemyActed B, …); we
// segment it and play it on a UI-only timeline so each hit is legible. The engine is never touched.

export type ReactionKind = 'lunge' | 'hit' | 'block' | 'heal'
export interface UnitReaction {
  kind: ReactionKind
  seq: number
}
export interface UnitFloat {
  tone: 'dmg' | 'heal'
  amount: number
  seq: number
}
export type TurnCueKind = 'party' | 'enemy'

export interface CombatFeedback {
  reactions: Record<string, UnitReaction>
  floats: Record<string, UnitFloat>
  shake: number
  energyPulse: number
  turnCue: { kind: TurnCueKind; seq: number } | null
  reduced: boolean
}

// per-enemy step cadence during the staggered enemy turn
const STEP_MS = 540
const HIT_DELAY = 160

type FxStep = {
  reactions: Record<string, ReactionKind>
  floats: Record<string, { tone: 'dmg' | 'heal'; amount: number }>
  bigHit: boolean
}

export function useCombatFeedback(): CombatFeedback {
  const lastEvents = useGame((s) => s.lastEvents)
  const tick = useGame((s) => s.tick)
  const combat = useGame((s) => s.state.combat)
  const settingReduced = useGame((s) => s.state.profile.settings.reducedMotion)
  const osReduced = useReducedMotion()
  const reduced = Boolean(settingReduced || osReduced)

  const [fb, setFb] = useState<Omit<CombatFeedback, 'reduced'>>({
    reactions: {},
    floats: {},
    shake: 0,
    energyPulse: 0,
    turnCue: null,
  })
  const seqRef = useRef(0)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const prevEnergyRef = useRef<number | null>(null)

  useEffect(() => {
    // A new dispatch always supersedes any in-flight enemy-turn timeline (the player may act mid-stagger;
    // the queue only schedules VISUAL state, never dispatches, so input is never blocked).
    for (const id of timersRef.current) clearTimeout(id)
    timersRef.current = []
    if (!combat) {
      prevEnergyRef.current = null
      return
    }

    const energyNow = combat.energy.current
    const prevEnergy = prevEnergyRef.current
    prevEnergyRef.current = energyNow
    if (!lastEvents.length) return

    // Turn a list of events into a single fx bundle (reactions + rising numbers + a big-hit flag).
    const bundle = (events: GameEvent[]): FxStep => {
      const reactions: Record<string, ReactionKind> = {}
      const floats: Record<string, { tone: 'dmg' | 'heal'; amount: number }> = {}
      let bigHit = false
      for (const e of events) {
        if (e.type === 'damageDealt') {
          if (e.amount > 0) {
            reactions[e.targetId] = 'hit'
            floats[e.targetId] = { tone: 'dmg', amount: (floats[e.targetId]?.amount ?? 0) + e.amount }
            const tgt = combat.combatants[e.targetId]
            // shake the field when the PARTY takes a meaningful hit
            if (tgt && tgt.faction === 'party' && e.amount >= Math.max(6, tgt.maxHp * 0.12)) bigHit = true
          } else if (e.blocked > 0 && reactions[e.targetId] == null) {
            reactions[e.targetId] = 'block'
          }
        } else if (e.type === 'healed' && e.amount > 0) {
          reactions[e.targetId] = 'heal'
          floats[e.targetId] = { tone: 'heal', amount: (floats[e.targetId]?.amount ?? 0) + e.amount }
        } else if (e.type === 'blockGained' && e.amount > 0 && reactions[e.targetId] == null) {
          reactions[e.targetId] = 'block'
        }
      }
      return { reactions, floats, bigHit }
    }

    type Commit = Partial<FxStep> & { energyPulse?: boolean; cue?: TurnCueKind }
    const commit = (c: Commit) => {
      const s = ++seqRef.current
      setFb((prev) => {
        const reactions = { ...prev.reactions }
        const floats = { ...prev.floats }
        if (c.reactions) for (const id in c.reactions) reactions[id] = { kind: c.reactions[id]!, seq: s }
        if (c.floats) for (const id in c.floats) floats[id] = { ...c.floats[id]!, seq: s }
        return {
          reactions,
          floats,
          shake: c.bigHit ? s : prev.shake,
          energyPulse: c.energyPulse ? s : prev.energyPulse,
          turnCue: c.cue ? { kind: c.cue, seq: s } : prev.turnCue,
        }
      })
    }

    // The party's own card resolves immediately; the enemy turn is staggered for legibility.
    const isEnemyTurn = lastEvents.some((e) => e.type === 'enemyActed')

    if (!isEnemyTurn || reduced) {
      const step = bundle(lastEvents)
      // the played card's owner (a party member) lunges toward the field
      const sourceId = playedSourceId(combat, lastEvents)
      if (sourceId && step.reactions[sourceId] == null) step.reactions[sourceId] = 'lunge'
      const energySpent = prevEnergy != null && energyNow < prevEnergy
      commit({ ...step, energyPulse: energySpent })
      return
    }

    // Segment the flat batch on each `enemyActed`, then play the segments on a timeline.
    const segments: { actorId: string; events: GameEvent[] }[] = []
    let cur: { actorId: string; events: GameEvent[] } | null = null
    for (const e of lastEvents) {
      if (e.type === 'enemyActed') {
        cur = { actorId: e.id, events: [] }
        segments.push(cur)
      } else if (cur) {
        cur.events.push(e)
      }
    }
    commit({ cue: 'enemy' })
    let t = 0
    for (const seg of segments) {
      const at = t
      timersRef.current.push(setTimeout(() => commit({ reactions: { [seg.actorId]: 'lunge' } }), at))
      timersRef.current.push(setTimeout(() => commit(bundle(seg.events)), at + HIT_DELAY))
      t += STEP_MS
    }
    timersRef.current.push(setTimeout(() => commit({ cue: 'party' }), t + HIT_DELAY))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  // clear pending timers on unmount
  useEffect(() => () => { for (const id of timersRef.current) clearTimeout(id) }, [])

  return { ...fb, reduced }
}

// Resolve the combatant that played the card in this batch: cardPlayed → instance owner (a MemberId,
// found in any pile post-play) → the party combatant carrying that memberId.
function playedSourceId(combat: CombatState, events: GameEvent[]): string | null {
  const played = events.find((e): e is Extract<GameEvent, { type: 'cardPlayed' }> => e.type === 'cardPlayed')
  if (!played) return null
  const piles = [combat.hand, combat.discardPile, combat.exhaustPile, combat.drawPile]
  let ownerId: string | undefined
  for (const pile of piles) {
    const ci = pile.find((c) => c.iid === played.iid)
    if (ci) {
      ownerId = ci.ownerId
      break
    }
  }
  if (!ownerId) return null
  const actor = Object.values(combat.combatants).find((c) => c.memberId === ownerId && c.faction === 'party')
  return actor?.id ?? null
}
