import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import type { GameState } from '../state/gameState'

// World/adventure sub-reducer. Implemented in Phase 4 (movement FSM, scenes, inventory, events,
// fireplace, encounter handoff). Until then it rejects world commands cleanly.
export function reduceWorld(state: GameState, cmd: Command): ReduceResult {
  void cmd
  const events: GameEvent[] = [{ type: 'rejected', reason: 'world-not-implemented' }]
  return { state, events }
}
