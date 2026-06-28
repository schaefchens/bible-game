// The persistent-power registry. A power is a hook table: each hook is a PURE function of
// (self, stacks, combat snapshot) returning EffectOps that the dispatcher (combat.ts fireHook) folds
// through the SAME applyEffect interpreter cards use — powers never get a private effect path. Two
// powers carry NO hook here because they are pipeline reads handled inline (whetstone in applyEffect's
// damage case; bastion in damageTarget) — exactly as Strength/Dexterity are read in the damage/block
// paths rather than via a hook.

import type { EffectOp, PowerId } from '../cards/types'
import type { Combatant, CombatState } from './types'

/** The events a power can react to. Fired from the turn FSM (combat.ts), never from inside applyEffect,
 *  so a hook's emitted ops can never re-fire a hook (no re-entrancy with this MVP set). */
export type HookName = 'onRoundStart' | 'onCardPlayed' | 'onAttackPlayed'

export interface PowerHookCtx {
  /** the combatant that holds this power (the caster of the installing card) */
  self: Combatant
  /** stacks of this power on `self` */
  stacks: number
  /** read-only combat snapshot (for transient counters like cardsPlayedThisTurn / firstAttackUsedThisTurn) */
  combat: CombatState
}

export interface PowerDef {
  hooks: Partial<Record<HookName, (ctx: PowerHookCtx) => EffectOp[]>>
}

export const POWERS: Record<PowerId, PowerDef> = {
  // Steadfast — gather Strength every round.
  steadfast: { hooks: { onRoundStart: ({ stacks }) => [{ kind: 'applyStatus', status: 'strength', stacks, target: 'self' }] } },
  // Fury — a slow, safe Strength scaler.
  fury: { hooks: { onRoundStart: ({ stacks }) => [{ kind: 'applyStatus', status: 'strength', stacks, target: 'self' }] } },
  // Menace — a renewing enemy debuff: weaken the front foe each round.
  menace: { hooks: { onRoundStart: ({ stacks }) => [{ kind: 'applyStatus', status: 'weak', stacks, target: 'enemy' }] } },
  // Bulwark — free Block every round (scales by level + Dexterity).
  bulwark: { hooks: { onRoundStart: ({ stacks }) => [{ kind: 'block', amount: stacks, target: 'self' }] } },
  // Momentum — every Nth card played this turn draws 1 (N=3, or 2 at 2+ stacks).
  momentum: {
    hooks: {
      onCardPlayed: ({ stacks, combat }) => {
        const every = stacks >= 2 ? 2 : 3
        return combat.cardsPlayedThisTurn > 0 && combat.cardsPlayedThisTurn % every === 0 ? [{ kind: 'draw', count: 1 }] : []
      },
    },
  },
  // Adrenaline — the FIRST attack each turn refunds 1 energy (gated).
  adrenaline: { hooks: { onAttackPlayed: ({ combat }) => (combat.firstAttackUsedThisTurn ? [] : [{ kind: 'gainEnergy', amount: 1 }]) } },
  // Whetstone — pipeline read in applyEffect (first damage op of an attack). No hook.
  whetstone: { hooks: {} },
  // Bastion — pipeline read in damageTarget (first HP hit/round blunted). No hook.
  bastion: { hooks: {} },
}
