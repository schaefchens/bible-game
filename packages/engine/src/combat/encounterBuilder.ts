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
import { startCombat, type CombatStep } from './combat'
import type { Combatant } from './types'

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
    spiritualBlock: 0,
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

function enemyCombatant(t: EnemyTemplate, heroLevel: number, runDepth: number): Combatant {
  const stats = scaleEnemy(t.scaling, heroLevel, runDepth)
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
    spiritualBlock: 0,
    side: t.side ?? 'right',
    row: t.row ?? 'front',
    stats,
    scale: enemyScale(heroLevel, runDepth),
    statuses: [],
    hidden: t.hidden,
    revealsId: t.revealsId,
    boundToId: t.boundToId,
    dread: t.dread,
    spiritualArmor: t.spiritualArmor,
    aiProfileId: t.aiProfileId,
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
  const heroLevel = run.party[0]?.level ?? 1

  const party = living.map(partyCombatant)
  const enemies = enc.enemies.map((t) => enemyCombatant(t, heroLevel, run.depth))

  const deck: CardInstance[] = []
  const cardDefs: Record<CardDefId, CardDef> = {}
  let energyMax = 0
  for (const m of living) {
    energyMax += m.contributesEnergy
    const defs = run.deckByMember[m.memberId] ?? []
    defs.forEach((defId, i) => {
      deck.push({ iid: `${m.memberId}#${i}`, defId, ownerId: m.memberId })
      const def = run.content.cards[defId]
      if (def) cardDefs[defId] = def
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
