// The selectable adventures (display metadata), shared by single-player WorldSelect and the co-op
// game browser / create / lobby. Title/subtitle are i18n keys; `bg` is the card art (public/assets).
// Progression: tutorial (world-02) → Valley of Elah (world-03) + The Road to Jericho (world-01)
// unlock together once the tutorial is completed.

export interface WorldMeta {
  id: string
  titleKey: string
  subtitleKey: string
  bg: string
  tagKey?: string
  unlockedBy?: string
}

export const WORLDS: WorldMeta[] = [
  { id: 'world-02', titleKey: 'ui.worldSelect.world02.title', subtitleKey: 'ui.worldSelect.world02.subtitle', bg: 'bg-rest-old-cistern.webp', tagKey: 'ui.worldSelect.tutorialTag' },
  { id: 'world-03', titleKey: 'ui.worldSelect.world03.title', subtitleKey: 'ui.worldSelect.world03.subtitle', bg: 'bg-combat-rocky-pass.webp', unlockedBy: 'world-02' },
  { id: 'world-01', titleKey: 'ui.worldSelect.world01.title', subtitleKey: 'ui.worldSelect.world01.subtitle', bg: 'bg-road-dusty-road.webp', unlockedBy: 'world-02' },
]

/** Display metadata for a world id (falls back to a minimal record keyed by the id itself). */
export function worldMeta(id: string): WorldMeta {
  return WORLDS.find((w) => w.id === id) ?? { id, titleKey: id, subtitleKey: '', bg: '' }
}
