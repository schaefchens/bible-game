import type { CardDefId, CharacterId, GraceAbilityId, I18nKey, MemberId } from '../types'
import { deriveStats, HP_UNIT, POINTS_PER_LEVEL } from '../leveling/scaling'
import { type ClassId, DEFAULT_CLASS_ID, heroClassDef } from './heroClasses'
import { allocPoints, emptyAllocation, STAT_IDS, type StatAllocation } from './stats'

/** Default starting purse when a character defines no per-type `startGold`. */
export const DEFAULT_START_GOLD = 50

/** Testing gimmick: a hero with this exact (trimmed) name spawns at max level with every card
 *  unlocked — for exercising scaling + the full card library without grinding. */
export const TEST_HERO_NAME = 'Enoch'

/** The PERMANENT hero — persists across runs (WoW/Diablo style). Created once, named by the player. */
export interface Character {
  id: CharacterId
  name: string
  level: number
  /** total accumulated XP */
  xp: number
  /** points SPENT per stat. Points are not a stored resource: total available = (level-1)·POINTS_PER_LEVEL
   *  and unspent = that minus what's allocated here (see unspentPoints). A respec just zeroes this. */
  allocated: StatAllocation
  /** verse cards permanently earned (carry across runs) */
  ownedVerseCardIds: CardDefId[]
  /** verse cards lost by failing the gap-fill 3× — no longer offered when studying; must be
   *  re-acquired (a future "buy/find" path). Permanent like ownedVerseCardIds. */
  lostVerseCardIds: CardDefId[]
  /** failed gap-fill attempts so far, per verse card. PERSISTENT (not on the transient prompt) so
   *  cancelling the modal and re-studying resumes the count instead of resetting to a fresh 3. */
  verseAttempts: Record<CardDefId, number>
  /** PERSISTENT card pool — the extra cards this hero has permanently unlocked via events/shop,
   *  beyond the content base pool + level unlocks (which are derived from `level`). Reward/shop
   *  offers sample from the *effective* pool (see cards/pool.ts). Carries across runs. */
  pool: CardDefId[]
  /** creation order, for stable slot sorting */
  createdSeq: number
  /** the chosen class (Zealot / Shepherd / Merchant) — drives base stats + the passive perk + starter
   *  deck. Undefined only on engine test fixtures (neutral baseline); persisted legacy saves default to
   *  Shepherd on load (schema.ts). */
  classId?: ClassId
  // Legacy per-type stat overrides (pre-class saves never persisted these — the schema strips them —
  // so they're effectively unused now that stats derive from classId; kept for a possible future
  // per-hero override without a class change.)
  baseHp?: number
  power?: number
  startGold?: number
}

/** Base HP for a character (level-1 units): an explicit override, else the class base, else neutral 50. */
export const characterBaseHp = (c: Pick<Character, 'baseHp' | 'classId'>): number =>
  c.baseHp ?? (c.classId ? heroClassDef(c.classId).baseHp : HP_UNIT)
/** Flesh-damage multiplier: an explicit override, else the class power, else neutral 1. */
export const characterPower = (c: Pick<Character, 'power' | 'classId'>): number =>
  c.power ?? (c.classId ? heroClassDef(c.classId).power : 1)
/** Starting purse: an explicit override, else the class purse, else the neutral default. */
export const characterStartGold = (c: Pick<Character, 'startGold' | 'classId'>): number =>
  c.startGold ?? (c.classId ? heroClassDef(c.classId).startGold : DEFAULT_START_GOLD)

export function createCharacter(id: CharacterId, name: string, createdSeq: number, classId?: ClassId): Character {
  return {
    id,
    name,
    level: 1,
    xp: 0,
    allocated: emptyAllocation(),
    ownedVerseCardIds: [],
    lostVerseCardIds: [],
    verseAttempts: {},
    pool: [],
    createdSeq,
    classId,
  }
}

/** Total skill points a level grants (level 1 = 0). Points are earned purely by level — an algorithm,
 *  not a stored resource — so a hero always has exactly this many, however they reached the level. */
export const totalSkillPoints = (level: number): number => Math.max(0, (level - 1) * POINTS_PER_LEVEL)

/** Points already spent across all stats. */
export const spentPoints = (allocated: StatAllocation): number =>
  STAT_IDS.reduce((sum, stat) => sum + allocPoints(allocated, stat), 0)

/** Points still available to spend = the level's total minus what's allocated. */
export const unspentPoints = (c: Pick<Character, 'level' | 'allocated'>): number =>
  Math.max(0, totalSkillPoints(c.level) - spentPoints(c.allocated))

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
  /** the hero's class — carried so combat/reward can read its perks without the Character (undefined for
   *  companions / neutral test heroes). */
  classId?: ClassId
  /** per-type base HP (level-1 units) — carried so combat/rest re-derive HP without the Character */
  baseHp: number
  /** per-type flesh-damage multiplier (1 = default) */
  power: number
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
  const baseHp = characterBaseHp(character)
  const maxHp = deriveStats(character.level, character.allocated, baseHp).maxHp
  return {
    memberId: heroMemberId(character.id),
    kind: 'hero',
    characterId: character.id,
    displayName: character.name,
    archetype: 'hero',
    isHuman: true,
    level: character.level,
    allocated: { ...character.allocated },
    classId: character.classId,
    baseHp,
    power: characterPower(character),
    currentHp: maxHp,
    contributesEnergy: 3,
    contributesCardDefIds: [...deck],
    graceAbilityIds: [...graceAbilityIds],
  }
}

export const memberMaxHp = (m: PartyMember): number => deriveStats(m.level, m.allocated, m.baseHp).maxHp
