// Deterministic enemy AI. Enemies telegraph an intent at round start (beginRound) and execute it on
// their turn (executeIntent). Pure: an intent depends only on the combatant and the round number.
//
// Most foes use `defaultIntent` (a demon with dread favors its spirit-layer attack; everyone else
// attacks). Bosses/elites set `aiProfileId` to select a coded multi-turn pattern with enrage — the
// patterns only emit intent kinds the combat core already executes (attack/attackMulti/dread/block/
// buff/debuff), so this is a selection layer, not new execution.

import type { Combatant, Intent, IntentKind } from './types'

export interface AiContext {
  /** 1-based round number; patterns cycle on it. */
  round: number
}

const isBound = (e: Combatant): boolean => e.statuses.some((s) => s.id === 'bound' && s.stacks > 0)

export function pickIntent(enemy: Combatant, ctx: AiContext = { round: 1 }): Intent {
  // bound enemies waste their turn (executeIntent skips + decrements a stack) — must take precedence
  if (isBound(enemy)) return { kind: 'special', value: 0 }
  if (enemy.aiProfileId) return profileIntent(enemy, enemy.aiProfileId, ctx.round)
  return defaultIntent(enemy)
}

function defaultIntent(enemy: Combatant): Intent {
  if (enemy.isDemon && enemy.dread !== undefined && enemy.dread > 0) {
    return { kind: 'dread', value: enemy.dread }
  }
  return { kind: 'attack', value: Math.max(1, enemy.stats.attack) }
}

/** Coded boss/elite patterns. `round` is 1-based; "enrage" triggers below half HP. */
function profileIntent(enemy: Combatant, profileId: string, round: number): Intent {
  const enraged = enemy.hp * 2 < enemy.maxHp
  const atk = Math.max(1, enemy.stats.attack)
  const at = <T>(cycle: readonly T[]): T => cycle[(round - 1) % cycle.length]!

  switch (profileId) {
    case 'goliath': {
      // brace (gather strength) → wind-up smash (multi-hit) → guard; enraged, he drops the guard and
      // hammers — punishing a stalled, flesh-only game and rewarding spiritual burst before half HP.
      const cycle: IntentKind[] = enraged ? ['buff', 'attackMulti', 'attackMulti'] : ['buff', 'attackMulti', 'block']
      const kind = at(cycle)
      if (kind === 'buff') return { kind: 'buff', status: 'strength', stacks: enraged ? 3 : 2 }
      if (kind === 'attackMulti') return { kind: 'attackMulti', value: atk, hits: enraged ? 4 : 3 }
      return { kind: 'block', value: atk }
    }
    case 'champion': {
      // weaken the hero, then strike; enraged he makes you vulnerable and hits twice as hard
      const kind = at(['debuff', 'attack'] as const)
      if (kind === 'debuff') return { kind: 'debuff', status: enraged ? 'vulnerable' : 'weak', stacks: 2 }
      return { kind: 'attack', value: enraged ? atk * 2 : atk }
    }
    case 'dreadSpirit': {
      // spirit-layer pressure (only ward stops it), salted with a vulnerability curse
      const kind = at(['dread', 'debuff', 'dread'] as const)
      if (kind === 'debuff') return { kind: 'debuff', status: 'vulnerable', stacks: 1 }
      return { kind: 'dread', value: enemy.dread ?? atk }
    }
    default:
      return defaultIntent(enemy)
  }
}
