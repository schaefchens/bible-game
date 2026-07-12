import type { Row, Side } from '../combat/types'
import type { ContentBundle } from '../content/bundle'
import type { Verb } from '../scene/types'
import type { Character } from '../state/character'
import type { ScreenId, Settings } from '../state/gameState'
import type { StatId } from '../state/stats'
import type {
  CardDefId,
  CharacterId,
  CombatantId,
  DialogueId,
  DialogueNodeId,
  EventId,
  GraceAbilityId,
  HotspotId,
  ItemId,
  Locale,
  MemberId,
  NodeId,
  SceneId,
} from '../types'

/**
 * The single input vocabulary. The UI ONLY dispatches Commands; it never mutates state.
 * Namespaced by domain: meta (no prefix), `world/*`, `combat/*`, `verse/*`.
 * Commands that introduce entropy (new hero id, run seed) carry it in the payload, supplied by
 * the UI — so the engine stays a pure, deterministic function of (state, command).
 */
export type Command =
  // ---- meta / shell ----
  | { type: 'createHero'; id: CharacterId; name: string }
  | { type: 'deleteHero'; id: CharacterId }
  | { type: 'selectHero'; id: CharacterId }
  | { type: 'updateSettings'; settings: Partial<Settings> }
  | { type: 'navigate'; screen: ScreenId }
  | { type: 'setWorldDownloaded'; worldId: string; downloaded: boolean }
  | { type: 'startRun'; characterId: CharacterId; worldId: string; seed: string; content: ContentBundle }
  // Co-op run start: the party is assembled from EACH player's full permanent Character (the server
  // has no access to other players' local profiles). Entropy (seed) is supplied by the authoritative
  // server, which is the only caller. `heroes[0]` becomes the hero (party[0] / heroMemberId).
  | { type: 'startCoopRun'; heroes: Character[]; worldId: string; seed: string; content: ContentBundle }
  // Co-op: down a party member on demand (server-authored — e.g. a dropped player was kicked). Their
  // hero goes to 0 HP (out of play, revived at the next campfire like any downed member); if in combat,
  // their combatant is killed (cards purged, shared energy dropped).
  | { type: 'coop/downMember'; memberId: MemberId }
  // Co-op: a new player joins an ongoing run with their OWN hero (server-authored). The member is added
  // to the party at the party's co-op level, full HP, own starter deck — active from the next encounter.
  | { type: 'coop/addMember'; character: Character }
  | { type: 'abandonRun' }
  // ---- leveling ----
  // `memberId` is the member whose points are spent — in co-op the server validates it belongs to the sender.
  | { type: 'allocateStat'; memberId: MemberId; stat: StatId }
  // ---- world / adventure ----
  | { type: 'world/chooseEntry'; nodeId: NodeId }
  | { type: 'world/move'; target: NodeId }
  | { type: 'world/enter' }
  | { type: 'world/sceneInteract'; sceneId: SceneId; hotspotId: HotspotId; verb: Verb; itemId?: ItemId }
  | { type: 'world/leaveScene' }
  // `actorMemberId` on the economy commands below identifies WHICH party member acts (whose deck grows,
  // who is healed). It defaults to the hero (single-player unchanged); in co-op the server stamps it
  // with the sender's own member so a player can only spend/grow their own resources.
  | { type: 'world/useItemSelf'; itemId: ItemId; actorMemberId?: MemberId } // use an item on a member in a scene
  | { type: 'inventory/combineItems'; a: ItemId; b: ItemId } // item-on-item combination (recipes)
  | { type: 'world/eventChoice'; eventId: EventId; choiceId: string }
  | { type: 'world/dialogueChoice'; dialogueId: DialogueId; nodeId: DialogueNodeId; choiceId: string }
  | { type: 'world/leaveDialogue' }
  | { type: 'world/dismissStory' }
  | { type: 'world/fireplace'; action: 'rest' | 'pray' | 'leave' | 'study' | 'upgrade'; cardIndex?: number; fragmentId?: ItemId; actorMemberId?: MemberId }
  // ---- shop ----
  | { type: 'world/shopBuyCard'; nodeId: NodeId; defId: CardDefId; actorMemberId?: MemberId }
  | { type: 'world/shopBuyItem'; nodeId: NodeId; itemId: ItemId }
  | { type: 'world/shopRemoveCard'; nodeId: NodeId; cardIndex: number; actorMemberId?: MemberId }
  | { type: 'world/leaveShop' }
  | { type: 'world/advanceWorld' }
  // ---- combat ----
  | { type: 'combat/reposition'; moves: Array<{ id: CombatantId; row?: Row; side?: Side }> }
  | { type: 'combat/flee' }
  | { type: 'combat/beginAction' }
  // `actorMemberId` = the party member PLAYING the card (co-op: the human who clicked it), used as the
  // caster/source — so "self" targets (guard/heal) land on the player who played it, not the card's owner.
  // Defaults to the card's owner (single-player unchanged). The server stamps it with the sender's seat.
  | { type: 'combat/playCard'; iid: string; targetId?: CombatantId; cardTargetIids?: string[]; actorMemberId?: MemberId }
  | { type: 'combat/useGrace'; ability: GraceAbilityId; targetId?: CombatantId }
  | { type: 'combat/useItem'; itemId: ItemId; targetId?: CombatantId; sourceMemberId?: MemberId } // use a bag item in battle (heal an ally, …)
  | { type: 'combat/endTurn' }
  // stepped enemy turn (UI-paced): begin queues the actors; advance resolves the next one
  | { type: 'combat/beginEnemyTurn' }
  | { type: 'combat/advanceEnemyTurn' }
  // ---- reward (post-combat): claim spoils individually, pick one card (or skip), then leave ----
  | { type: 'combat/claimSpoil'; spoilId: string }
  | { type: 'combat/takeCard'; defId: CardDefId; actorMemberId?: MemberId }
  | { type: 'combat/skipCard'; actorMemberId?: MemberId }
  | { type: 'combat/leaveReward' }
  // ---- verse gap-fill ----
  // `locale` lets the acting player's own language validate the answer (mixed EN/DE parties); defaults
  // to the shared profile locale. `actorMemberId` is the member who earns the verse card.
  | { type: 'verse/submit'; challengeId: string; answers: string[]; actorMemberId?: MemberId; locale?: Locale }
  | { type: 'verse/cancel' }

export type CommandType = Command['type']
