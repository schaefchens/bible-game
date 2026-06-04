// Minimal, deterministic enemy AI for milestone 1: enemies telegraph an intent at round start
// and execute it on their turn. A demon with `dread` favors its spirit-layer attack (which only
// ward can stop); everything else attacks for its scaled attack value.

import type { Combatant, Intent } from './types'

export function pickIntent(enemy: Combatant): Intent {
  if (enemy.statuses.some((s) => s.id === 'bound' && s.stacks > 0)) {
    return { kind: 'special', value: 0 }
  }
  if (enemy.isDemon && enemy.dread !== undefined && enemy.dread > 0) {
    return { kind: 'dread', value: enemy.dread }
  }
  return { kind: 'attack', value: Math.max(1, enemy.stats.attack) }
}
