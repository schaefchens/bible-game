// The encounter builder — the seam between content (encounter + card defs), the run (party,
// persistent deck, hero level), and the combat engine. It materializes party + enemy Combatants
// (enemies SCALED to the hero's level/depth), assembles the SHARED deck/energy pool from
// deckByMember, gathers the card defs combat needs, and calls startCombat.

import type { CardDef, CardInstance } from '../cards/types'
import type { ContentBundle } from '../content/bundle'
import { deriveStats, enemyScale, levelScale, scaleEnemy } from '../leveling/scaling'
import type { RngState } from '../rng/rng'
import type { PartyMember } from '../state/character'
import type { RunState } from '../state/gameState'
import type { CardDefId, EncounterId, NodeId } from '../types'
import type { EnemyTemplate } from '../content/bundle'
import { ARCHETYPE_PROFILE } from './ai'
import { startCombat, type CombatStep } from './combat'
import type { Combatant, PowerInstance } from './types'

/** Persistent ENEMY auras installed by archetype at build time (fire each round via fireEnemyPowers
 *  while the holder lives). These are the enemy-to-enemy synergies — they reuse the player's power
 *  engine; only the holder's faction differs. Authors get them for free per archetype; nothing to wire
 *  in content. Goliath is intentionally omitted (his own brace step is his ramp; his shield-bearer
 *  company supplies the Aegis screen). */
const ARCHETYPE_POWERS: Record<string, PowerInstance[]> = {
  shieldBearer: [{ id: 'aegis', stacks: 3 }], // screens the whole line with Block each round
  philistineChampion: [{ id: 'warleader', stacks: 1 }], // rallies its soldiers' Strength each round
  idolSpirit: [{ id: 'warleader', stacks: 1 }], // empowers its bound host's line (once revealed)
}

function partyCombatant(m: PartyMember): Combatant {
  const stats = deriveStats(m.level, m.allocated)
  return {
    id: m.memberId,
    faction: 'party',
    archetype: m.archetype,
    isHuman: m.isHuman,
    alive: m.currentHp > 0,
    hp: Math.min(m.currentHp, stats.maxHp),
    maxHp: stats.maxHp,
    block: 0,
    side: 'left',
    row: 'front',
    stats,
    scale: levelScale(m.level),
    statuses: [],
    memberId: m.memberId,
    contributesEnergy: m.contributesEnergy,
    graceAbilityIds: m.graceAbilityIds,
  }
}

function enemyCombatant(
  t: EnemyTemplate,
  heroLevel: number,
  runDepth: number,
  partySize: number,
  lastStandWhenAlone?: boolean,
): Combatant {
  const stats = scaleEnemy(t.scaling, heroLevel, runDepth, partySize)
  return {
    id: t.id,
    faction: 'enemy',
    archetype: t.archetype,
    isHuman: t.isHuman,
    isDemon: t.isDemon,
    alive: true,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    block: 0,
    side: t.side ?? 'right',
    row: t.row ?? 'front',
    stats,
    scale: enemyScale(heroLevel, runDepth),
    statuses: [],
    powers: ARCHETYPE_POWERS[t.archetype],
    hidden: t.hidden,
    revealsId: t.revealsId,
    boundToId: t.boundToId,
    banishImmune: t.banishImmune,
    // strategy comes from the template's explicit aiProfileId, else the per-archetype default
    aiProfileId: t.aiProfileId ?? ARCHETYPE_PROFILE[t.archetype],
    lastStandWhenAlone,
  }
}

export function encounterExists(content: ContentBundle, encounterId: EncounterId): boolean {
  return content.encounters[encounterId] !== undefined
}

/** Build and start a combat for `encounterId` at `nodeId`, scaled to the run. */
export function buildEncounter(run: RunState, encounterId: EncounterId, nodeId: NodeId, rng: RngState): CombatStep {
  const enc = run.content.encounters[encounterId]
  if (!enc) throw new Error(`encounterBuilder: unknown encounter "${encounterId}"`)

  const living = run.party.filter((m) => m.currentHp > 0)
  const partySize = Math.max(1, living.length)
  // Scale enemies to the AVERAGE living hero level (co-op parties may be mixed-level); a solo run
  // collapses to the lone hero's level. Rounded, min 1. Enemy HP additionally scales with partySize.
  const levelPool = living.length > 0 ? living : run.party
  const heroLevel = Math.max(1, Math.round(levelPool.reduce((s, m) => s + m.level, 0) / Math.max(1, levelPool.length)))

  const party = living.map(partyCombatant)
  const enemies = enc.enemies.map((t) => enemyCombatant(t, heroLevel, run.depth, partySize, enc.lastStandWhenAlone))

  const deck: CardInstance[] = []
  // Embed the WHOLE card catalog (it is tiny + fully serializable). The deck below still only
  // materializes the player's cards, but combat must also resolve defs it doesn't start with:
  // enemy-injected clutter (Spike) and the `+` forms a `hone` card swaps in mid-battle.
  const cardDefs: Record<CardDefId, CardDef> = { ...run.content.cards }
  let energyMax = 0
  for (const m of living) {
    energyMax += m.contributesEnergy
    const defs = run.deckByMember[m.memberId] ?? []
    defs.forEach((defId, i) => {
      deck.push({ iid: `${m.memberId}#${i}`, defId, ownerId: m.memberId })
    })
  }

  return startCombat({
    rng,
    party,
    enemies,
    deck,
    cardDefs,
    energyMax,
    graceMax: run.baseGrace,
    formation: enc.formation,
    flags: enc.flags,
    winCondition: enc.winCondition,
    nodeId,
    encounterId,
    rewardOptions: enc.rewardOptions,
    rewardXp: enc.rewardXp,
    battleBg: enc.battleBg,
    rewardBg: enc.rewardBg,
  })
}
