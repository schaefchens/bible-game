import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import type { GameState } from '../state/gameState'

// Verse gap-fill sub-reducer. Wired in Phase 5 (validation logic lands in Phase 2). Until then
// it rejects verse submissions cleanly.
export function reduceVerse(state: GameState, cmd: Command): ReduceResult {
  void cmd
  const events: GameEvent[] = [{ type: 'rejected', reason: 'verse-not-implemented' }]
  return { state, events }
}
