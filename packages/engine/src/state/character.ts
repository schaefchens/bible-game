import type { CardDefId, CharacterId, GraceAbilityId, I18nKey, MemberId } from '../types'
import { deriveStats } from '../leveling/scaling'
import { emptyAllocation, type StatAllocation } from './stats'

/** The PERMANENT hero — persists across runs (WoW/Diablo style). Created once, named by the player. */
export interface Character {
  id: CharacterId
  name: string
  level: number
  /** total accumulated XP */
  xp: number
  allocated: StatAllocation
  /** stat points earned on level-up but not yet spent */
  unspentPoints: number
  /** verse cards permanently earned (carry across runs) */
  ownedVerseCardIds: CardDefId[]
  /** creation order, for stable slot sorting */
  createdSeq: number
}

export function createCharacter(id: CharacterId, name: string, createdSeq: number): Character {
  return {
    id,
    name,
    level: 1,
    xp: 0,
    allocated: emptyAllocation(),
    unspentPoints: 0,
    ownedVerseCardIds: [],
    createdSeq,
  }
}

export type MemberKind = 'hero' | 'companion'

/** A combatant slot in the active run. The hero links back to its permanent Character. */
export interface PartyMember {
  memberId: MemberId
  kind: MemberKind
  characterId?: CharacterId
  archetype: string
  /** hero uses the player-chosen name; companions use a localized key */
  displayName?: string
  nameKey?: I18nKey
  isHuman: boolean
  level: number
  allocated: StatAllocation
  /** current HP persists between combats (healed at fireplaces) */
  currentHp: number
  /** energy this member contributes to the SHARED party pool */
  contributesEnergy: number
  /** card definitions this member contributes to the SHARED deck */
  contributesCardDefIds: CardDefId[]
  graceAbilityIds: GraceAbilityId[]
}

export const heroMemberId = (characterId: CharacterId): MemberId => `m:hero:${characterId}`

/** Build the hero's party member from its permanent Character at run start. */
export function partyMemberFromCharacter(
  character: Character,
  deck: CardDefId[],
  graceAbilityIds: GraceAbilityId[],
): PartyMember {
  const maxHp = deriveStats(character.level, character.allocated).maxHp
  return {
    memberId: heroMemberId(character.id),
    kind: 'hero',
    characterId: character.id,
    displayName: character.name,
    archetype: 'hero',
    isHuman: true,
    level: character.level,
    allocated: { ...character.allocated },
    currentHp: maxHp,
    contributesEnergy: 3,
    contributesCardDefIds: [...deck],
    graceAbilityIds: [...graceAbilityIds],
  }
}

export const memberMaxHp = (m: PartyMember): number => deriveStats(m.level, m.allocated).maxHp
