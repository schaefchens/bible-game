import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import type { GameState } from '../state/gameState'

// Combat sub-reducer. Implemented in Phase 3 (turn FSM, EffectOp interpreter, damage pipeline,
// party pool, grace, win/defeat). Until then it rejects combat commands cleanly.
export function reduceCombat(state: GameState, cmd: Command): ReduceResult {
  void cmd
  const events: GameEvent[] = [{ type: 'rejected', reason: 'combat-not-implemented' }]
  return { state, events }
}
