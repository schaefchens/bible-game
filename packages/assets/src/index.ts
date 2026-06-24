// @bible/assets — the asset-abstraction layer. Content/engine reference visuals by AssetRef;
// this maps them to concrete URLs. Unknown refs return undefined so the UI falls back to a
// programmatic CSS placeholder — swapping in final art later means editing only this registry.
//
// Jericho-road backgrounds are referenced by their file STEM (e.g. "bg-explore-poor-family-house"),
// so content can name the exact image. Combat encounters use the "-sideview" stem for the battle
// and the plain stem for the reward.

// Every bg-*.png under apps/web/public/assets, by file stem.
const JERICHO_BG = [
  'bg-road-dusty-road',
  'bg-waypoint-olive-grove',
  'bg-waypoint-potters-field',
  'bg-waypoint-lower-well',
  'bg-waypoint-market-fork',
  'bg-waypoint-samaritan-road',
  'bg-waypoint-ruined-watchtower',
  'bg-waypoint-narrow-steps',
  'bg-explore-poor-family-house',
  'bg-event-wounded-traveler',
  'bg-shop-roadside-market',
  'bg-shop-merchant-camp',
  'bg-rest-old-cistern',
  'bg-rest-jericho-inn',
  'bg-rest-hidden-prayer-place',
  'bg-rest-quiet-cave',
  'bg-combat-dry-wash',
  'bg-combat-dry-wash-sideview',
  'bg-combat-shepherds-track',
  'bg-combat-shepherds-track-sideview',
  'bg-combat-ridge-path',
  'bg-combat-ridge-path-sideview',
  'bg-combat-broken-toll-gate',
  'bg-combat-broken-toll-gate-sideview',
  'bg-combat-rocky-pass',
  'bg-combat-rocky-pass-sideview',
  'bg-boss-narrow-gate',
  'bg-boss-narrow-gate-sideview',
]

// Deployment base, so asset URLs resolve under a subpath (e.g. served at "/game/"). The host app
// sets this once at startup from its bundler base (Vite: import.meta.env.BASE_URL). Default "/".
let assetBase = '/'
export function setAssetBase(base: string): void {
  assetBase = base || '/'
}

// Battle character sprites, keyed by combatant archetype. Drop a matching transparent PNG into
// apps/web/public/assets and it renders; until then the combat screen falls back to emoji.
const SPRITE_FILES: Record<string, string> = {
  'sprite/hero': 'sprite-hero.png',
  'sprite/companion': 'sprite-companion.png',
  'sprite/thief': 'sprite-thief.png',
  'sprite/robber': 'sprite-robber.png',
  'sprite/bandit': 'sprite-bandit.png',
  'sprite/demon': 'sprite-demon.png',
  'sprite/philistineSoldier': 'sprite-philistine-soldier.png',
  'sprite/philistineArcher': 'sprite-philistine-archer.png',
  'sprite/shieldBearer': 'sprite-shield-bearer.png',
  'sprite/philistineChampion': 'sprite-philistine-champion.png',
  'sprite/dagonZealot': 'sprite-dagon-zealot.png',
  'sprite/idolSpirit': 'sprite-idol-spirit.png',
  'sprite/spiritOfDread': 'sprite-spirit-of-dread.png',
  'sprite/goliath': 'sprite-goliath.png',
}

// Registry values are file names relative to the public "assets/" folder; resolveAsset prefixes the base.
const REGISTRY: Record<string, string> = {
  // Milestone-1 art (kept for fallback / older content)
  'scene/forest-house-inside': '002-2-forest-house-inside.jpg',
  'scene/forest-house-outside': '002-1-forest-house-outside.jpg',
  'scene/merchant-place': '001-merchant-place.jpg',
  'battlefield/forest': '004-battlefield-forest.png',
  'battlefield/enchanted-forest': '004-battlefield-enchanted-forest.png',
  'battlefield/hill': '004-battlefield-on-hill.png',
  'battlefield/crossroads': '004-battlefield-open-crossroads.png',
  'battlefield/seaside': '004-battlefield-seaside.png',
  'battlefield/open-road': '005-battlefield-open-road.png',
  // Background music (looping tracks). Resolved to URLs the same way as images.
  'music/startscreen': 'bg-music-startscreen.mp3',
  'music/map': 'bg-music-map.mp3',
  'music/map-tutorial': 'bg-music-map-tutorial.mp3',
  'music/map-elah': 'bg-music-map-elah.mp3',
  'music/battle-elah-boss': 'bg-music-battle-elah-boss.mp3',
  'music/inn': 'bg-music-inn.mp3',
  'music/sleep': 'bg-music-sleep.mp3', // one-shot cue (~10s) for the sleep cinematic
  // Registered + available; not yet assigned to any node/encounter (wire later as needed).
  'music/battle-intense': 'bg-music-battle-intense.mp3',
  'music/battle-calm': 'bg-music-battle-calm.mp3',
  'music/prayer': 'bg-music-prayer.mp3',
  // Jericho road — every bg by stem
  ...Object.fromEntries(JERICHO_BG.map((stem) => [stem, `${stem}.png`])),
  // Battle character sprites, by archetype
  ...SPRITE_FILES,
}

/** Concrete URL for an AssetRef under the current base (e.g. "/assets/x.png" or "/game/assets/x.png"). */
export function resolveAsset(ref: string | undefined): string | undefined {
  const file = ref ? REGISTRY[ref] : undefined
  return file ? `${assetBase}assets/${file}` : undefined
}

/** CSS `background-image` value for an AssetRef, or undefined (caller applies a placeholder). */
export function assetBg(ref: string | undefined): string | undefined {
  const url = resolveAsset(ref)
  return url ? `url(${url})` : undefined
}
