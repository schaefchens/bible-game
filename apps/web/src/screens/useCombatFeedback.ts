import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'
import type { CombatState, GameEvent } from '@bible/engine'
import { useGame } from '../store/gameStore'
import { sfxManager } from '../audio/sfxManager'
import { strikeSound, blockSound, deathSound, incapacitateSound, isWindupSound, sfxOpts } from '../audio/combatSfx'

// Combat feedback (juice) derived from the engine's event stream. The store applies one dispatch
// synchronously and exposes the resulting (state, lastEvents, tick) snapshot — `state` is already the
// FINAL post-event state and `lastEvents` is the diff of what happened. We turn that diff into transient
// visual cues. The enemy turn is now PACED by the UI (CombatScreen dispatches one `advanceEnemyTurn`
// per enemy), so each dispatch carries at most one enemy's `enemyActed` + its effects — we just play
// the wind-up→impact beat for that single actor. Banners are driven by enemyTurnBegan/Ended events.

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

// the wind-up → impact beat within a single actor's dispatch: lunge immediately, then land the hit
const HIT_DELAY = 160

type FxStep = {
  reactions: Record<string, ReactionKind>
  floats: Record<string, { tone: 'dmg' | 'heal'; amount: number }>
  bigHit: boolean
  // SFX keys to fire WHEN this step commits (so audio lands with the visual, incl. the +HIT_DELAY beat)
  sounds: string[]
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

    // Turn a list of events into a single fx bundle (reactions + rising numbers + a big-hit flag + the
    // SFX to fire on commit). `attackerArchetype` keys the strike sound to the blow's source where known.
    const bundle = (events: GameEvent[], attackerArchetype?: string): FxStep => {
      const reactions: Record<string, ReactionKind> = {}
      const floats: Record<string, { tone: 'dmg' | 'heal'; amount: number }> = {}
      let bigHit = false
      const sounds: string[] = []
      let struck = false // dedupe to ONE strike + ONE block clang per batch (a flurry is one beat here)
      let clanged = false
      for (const e of events) {
        if (e.type === 'damageDealt') {
          if (e.amount > 0) {
            reactions[e.targetId] = 'hit'
            floats[e.targetId] = { tone: 'dmg', amount: (floats[e.targetId]?.amount ?? 0) + e.amount }
            const tgt = combat.combatants[e.targetId]
            // shake the field when the PARTY takes a meaningful hit
            if (tgt && tgt.faction === 'party' && e.amount >= Math.max(6, tgt.maxHp * 0.12)) bigHit = true
            if (!struck) { sounds.push(strikeSound(attackerArchetype)); struck = true }
          } else if (e.blocked > 0 && reactions[e.targetId] == null) {
            reactions[e.targetId] = 'block'
            // a blow fully absorbed by Block → shield clang (blockGained, i.e. raising guard, is silent)
            if (!clanged) { sounds.push(blockSound()); clanged = true }
          }
        } else if (e.type === 'healed' && e.amount > 0) {
          reactions[e.targetId] = 'heal'
          floats[e.targetId] = { tone: 'heal', amount: (floats[e.targetId]?.amount ?? 0) + e.amount }
        } else if (e.type === 'blockGained' && e.amount > 0 && reactions[e.targetId] == null) {
          reactions[e.targetId] = 'block'
        } else if (e.type === 'combatantDied') {
          if (e.mode === 'killed') sounds.push(deathSound(combat.combatants[e.id]))
          else if (e.mode === 'subdued') sounds.push(incapacitateSound())
        }
      }
      return { reactions, floats, bigHit, sounds }
    }

    type Commit = Partial<FxStep> & { energyPulse?: boolean; cue?: TurnCueKind }
    const commit = (c: Commit) => {
      const s = ++seqRef.current
      // fire SFX in lockstep with the visual this commit applies (immediate, or the +HIT_DELAY beat).
      // The manager no-ops when audioMode === 'off' and scales by audioVolume.
      if (c.sounds) for (const key of c.sounds) sfxManager.play(key, sfxOpts(key))
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

    // Banners are event-driven: the stepped enemy turn opens with `enemyTurnBegan` and closes with
    // `enemyTurnEnded`. (The batch path used by reduced motion emits neither → no banner, instant.)
    if (lastEvents.some((e) => e.type === 'enemyTurnBegan')) commit({ cue: 'enemy' })
    const endedTurn = lastEvents.some((e) => e.type === 'enemyTurnEnded')
    const ended = lastEvents.find((e): e is Extract<GameEvent, { type: 'combatEnded' }> => e.type === 'combatEnded')
    const combatEnded = !!ended
    // battle result sting: a WIN is victory OR peaceful (subdued — no humans killed); lose on defeat.
    // 'fled' plays neither. (SFX ignores reduced-motion — it's audio, not animation.)
    if (ended?.outcome === 'victory' || ended?.outcome === 'peaceful') {
      // let the final blow (and its death cry) land first, then the win sting swells in ~½s later.
      // NOT in timersRef: the same step flips screen→reward and unmounts CombatScreen, whose cleanup
      // would clear timersRef and cancel this — a fire-and-forget one-shot must outlive the unmount.
      setTimeout(() => sfxManager.play('sfx/battle-won', { gain: 0.5 }), 500)
    } else if (ended?.outcome === 'defeat') sfxManager.play('sfx/battle-lost')

    // A single enemy's step (one `enemyActed`, UI-paced): wind up (lunge) now, land the hit shortly
    // after so the strike reads as cause → effect. Everything else (the player's own card/grace/item,
    // the reduced-motion batch enemy turn, or a no-actor resolve step) commits in one shot.
    const actor = lastEvents.find((e): e is Extract<GameEvent, { type: 'enemyActed' }> => e.type === 'enemyActed')
    if (actor && !reduced) {
      const step = bundle(lastEvents, combat.combatants[actor.id]?.archetype)
      // a ranged attacker looses at the wind-up: play its release sound WITH the lunge so the arrow is
      // heard flying, then lands. Melee thuds + death cries stay on the impact beat (+HIT_DELAY).
      const windup = step.sounds.filter(isWindupSound)
      const onImpact = step.sounds.filter((s) => !isWindupSound(s))
      commit({ reactions: { [actor.id]: 'lunge' }, sounds: windup })
      timersRef.current.push(setTimeout(() => commit({ ...step, sounds: onImpact }), HIT_DELAY))
    } else {
      // the played card's owner (a party member) lunges toward the field — and keys its strike sound
      const sourceId = playedSourceId(combat, lastEvents)
      const step = bundle(lastEvents, sourceId ? combat.combatants[sourceId]?.archetype : undefined)
      if (sourceId && step.reactions[sourceId] == null) step.reactions[sourceId] = 'lunge'
      const energySpent = prevEnergy != null && energyNow < prevEnergy
      commit({ ...step, energyPulse: energySpent })
    }

    // hand control back to the party — unless the fight just ended on this very step (game over /
    // victory takes over the screen, so "Your Turn" would be wrong).
    if (endedTurn && !combatEnded) {
      timersRef.current.push(setTimeout(() => commit({ cue: 'party' }), HIT_DELAY + 40))
    }
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
