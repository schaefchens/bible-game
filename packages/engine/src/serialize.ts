import { GAME_STATE_VERSION, type GameState } from './state/gameState'

// GameState is designed to be pure JSON: no Map/Set/bigint (the RNG state is a number tuple,
// graphs use arrays/records). So serialization is straight JSON with a version gate. Deep
// structural validation (zod) is the persistence layer's job, not the engine's.

export function serialize(state: GameState): string {
  return JSON.stringify(state)
}

export function deserialize(json: string): GameState {
  const parsed: unknown = JSON.parse(json)
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid save: not an object')
  const version = (parsed as { version?: unknown }).version
  if (typeof version !== 'number') throw new Error('invalid save: missing version')
  if (version !== GAME_STATE_VERSION) throw new Error(`unsupported save version: ${String(version)}`)
  return parsed as GameState
}
