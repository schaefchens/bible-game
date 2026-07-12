// The encounter builder — the seam between content (encounter + card defs), the run (party,
// persistent deck, hero level), and the combat engine. It materializes party + enemy Combatants
// (enemies SCALED to the hero's level/depth), assembles the SHARED deck/energy pool from
// deckByMember, gathers the card defs combat needs, and calls startCombat.

import type { CardDef, CardInstance } from '../cards/types'
import type { ContentBundle } from '../content/bundle'
import { allocMult, deriveStats, dmgScale, enemyDamageScale, scaleEnemy } from '../leveling/scaling'
import { allocPoints } from '../state/stats'
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
  const stats = deriveStats(m.level, m.allocated, m.baseHp)
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
    scale: dmgScale(m.level),
    // per-type power × the dmg-allocation bonus (+1%/point); defend-allocation lifts block gained
    power: m.power * allocMult(allocPoints(m.allocated, 'dmg')),
    blockMult: allocMult(allocPoints(m.allocated, 'defend')),
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
    scale: enemyDamageScale(heroLevel, runDepth),
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
  // Scale enemies to the MAX living hero level (co-op parties keep their own levels; the strongest sets
  // the bracket, and enemies trail a decade behind via enemyBracketLevel). Solo → the lone hero's level.
  const levelPool = living.length > 0 ? living : run.party
  const heroLevel = Math.max(1, ...levelPool.map((m) => m.level))

  const party = living.map(partyCombatant)
  const enemies = enc.enemies.map((t) => enemyCombatant(t, heroLevel, run.depth, partySize, enc.lastStandWhenAlone))

  const deck: CardInstance[] = []
  // Embed the WHOLE card catalog (it is tiny + fully serializable). The deck below still only
  // materializes the player's cards, but combat must also resolve defs it doesn't start with:
  // enemy-injected clutter (Spike) and the `+` forms a `hone` card swaps in mid-battle.
  const cardDefs: Record<CardDefId, CardDef> = { ...run.content.cards }
  // Shared energy pool: the first party member brings their full energy; each ADDITIONAL member adds only
  // +1 (not their full contribution) — so a co-op party of 1/2/3 has 3/4/5 energy, not 3/6/9.
  let energyMax = 0
  living.forEach((m, i) => {
    energyMax += i === 0 ? m.contributesEnergy : 1
    const defs = run.deckByMember[m.memberId] ?? []
    defs.forEach((defId, j) => {
      deck.push({ iid: `${m.memberId}#${j}`, defId, ownerId: m.memberId })
    })
  })

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
