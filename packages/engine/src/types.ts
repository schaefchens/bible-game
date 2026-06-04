// Shared id/string vocabulary used across engine domains. Ids are plain strings (branding
// omitted for ergonomics). The engine references all human-facing text by I18nKey and all
// visuals by AssetRef — it never holds display strings or pixels.

export type I18nKey = string
export type AssetRef = string

export type CardDefId = string
export type CharacterId = string
export type MemberId = string
export type CombatantId = string
export type NodeId = string
export type EdgeId = string
export type SceneId = string
export type HotspotId = string
export type EventId = string
export type EncounterId = string
export type ItemId = string
export type GraceAbilityId = string

export type Locale = 'en' | 'de'
export const LOCALES: readonly Locale[] = ['en', 'de']
