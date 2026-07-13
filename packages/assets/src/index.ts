// @bible/assets — the asset-abstraction layer. Content/engine reference visuals by AssetRef;
// this maps them to concrete URLs. Unknown refs return undefined so the UI falls back to a
// programmatic CSS placeholder — swapping in final art later means editing only this registry.
//
// Jericho-road backgrounds are referenced by their file STEM (e.g. "bg-explore-poor-family-house"),
// so content can name the exact image. Combat encounters use the "-sideview" stem for the battle
// and the plain stem for the reward.

// Every bg-*.webp under apps/web/public/assets, by file stem.
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
  'sprite/hero': 'sprite-hero.webp',
  'sprite/companion': 'sprite-companion.webp',
  'sprite/thief': 'sprite-thief.webp',
  'sprite/robber': 'sprite-robber.webp',
  'sprite/bandit': 'sprite-bandit.webp',
  'sprite/demon': 'sprite-demon.webp',
  'sprite/philistineSoldier': 'sprite-philistine-soldier.webp',
  'sprite/philistineArcher': 'sprite-philistine-archer.webp',
  'sprite/shieldBearer': 'sprite-shield-bearer.webp',
  'sprite/philistineChampion': 'sprite-philistine-champion.webp',
  'sprite/dagonZealot': 'sprite-dagon-zealot.webp',
  'sprite/idolSpirit': 'sprite-idol-spirit.webp',
  'sprite/spiritOfDread': 'sprite-spirit-of-dread.webp',
  'sprite/goliath': 'sprite-goliath.webp',
}

// Registry values are file names relative to the public "assets/" folder; resolveAsset prefixes the base.
const REGISTRY: Record<string, string> = {
  // Milestone-1 art (kept for fallback / older content)
  'scene/forest-house-inside': '002-2-forest-house-inside.jpg',
  'scene/forest-house-outside': '002-1-forest-house-outside.jpg',
  'scene/merchant-place': '001-merchant-place.jpg',
  'battlefield/forest': '004-battlefield-forest.webp',
  'battlefield/enchanted-forest': '004-battlefield-enchanted-forest.webp',
  'battlefield/hill': '004-battlefield-on-hill.webp',
  'battlefield/crossroads': '004-battlefield-open-crossroads.webp',
  'battlefield/seaside': '004-battlefield-seaside.webp',
  'battlefield/open-road': '005-battlefield-open-road.webp',
  // Background music (looping tracks). Resolved to URLs the same way as images.
  'music/startscreen': 'bg-music-startscreen.mp3',
  'music/map': 'bg-music-map.mp3',
  'music/map-tutorial': 'bg-music-map-tutorial.mp3',
  'music/map-elah': 'bg-music-map-elah.mp3',
  'music/battle-elah-boss': 'bg-music-battle-elah-boss.mp3',
  'music/inn': 'bg-music-inn.mp3',
  'music/sleep': 'bg-music-sleep.mp3', // one-shot cue (~10s) for the sleep cinematic
  'music/startup': 'bg-music-startup.mp3', // calm ambient bed under the studio-logo intro (StartupSequence)
  // Registered + available; not yet assigned to any node/encounter (wire later as needed).
  'music/battle-intense': 'bg-music-battle-intense.mp3',
  'music/battle-calm': 'bg-music-battle-calm.mp3',
  'music/prayer': 'bg-music-prayer.mp3',
  // Combat SFX (one-shots). Played by sfxManager; gated on audioMode !== 'off', scaled by audioVolume.
  'sfx/strike-1': 'sfx-strike-1.mp3',
  'sfx/strike-2': 'sfx-strike-2.mp3',
  'sfx/strike-3': 'sfx-strike-3.mp3',
  'sfx/strike-4': 'sfx-strike-4.mp3',
  'sfx/strike-5': 'sfx-strike-5.mp3',
  'sfx/strike-6': 'sfx-strike-6.mp3',
  'sfx/strike-7': 'sfx-strike-7.mp3',
  'sfx/strike-goliath': 'sfx-strike-goliath.mp3',
  'sfx/strike-arrow': 'sfx-strike-arrow.mp3',
  'sfx/block-1': 'sfx-block-1.mp3',
  'sfx/block-2': 'sfx-block-2.mp3',
  'sfx/death-human': 'sfx-death-human.mp3',
  'sfx/death-spirit': 'sfx-death-spirit.mp3',
  'sfx/death-spirit-2': 'sfx-death-spirit-2.mp3',
  'sfx/death-monster': 'sfx-death-monster.mp3',
  'sfx/death-goliath': 'sfx-death-goliath.mp3',
  'sfx/incapacitate': 'sfx-incapacitate.mp3',
  'sfx/levelup': 'sfx-levelup.mp3', // played when a hero reaches a new level (reward screen + co-op chat)
  'sfx/battle-won': 'sfx-battle-won.mp3', // last enemy defeated
  'sfx/battle-lost': 'sfx-battle-lost.mp3', // the hero (party) died
  'sfx/xp-charge': 'sfx-xp-charge.mp3', // sustained hum while the reward XP bar animates (looped, stopped on finish)
  // Studio-logo intro stings (StartupSequence). One-shots; gated/scaled like other SFX.
  'sfx/logo-whoosh': 'sfx-logo-whoosh.mp3',
  'sfx/logo-whoosh-soft': 'sfx-logo-whoosh-soft.mp3',
  'sfx/logo-sheep': 'sfx-logo-sheep.mp3',
  'sfx/logo-ding': 'sfx-logo-ding.mp3',
  'sfx/light-switch': 'sfx-light-switch.mp3', // studio-light click → triggers the Lamm light-on bloom
  // Studio-logo intro art (StartupSequence). All four ship real graphics; any unregistered ref falls
  // back to a styled CSS card (same image-or-fallback pattern as the battle sprites).
  'logo/lamm': 'logo-lamm.webp',
  'logo/god': 'logo-god.webp',
  'logo/claude': 'logo-claude.svg',
  'logo/misselle': 'logo-misselle.webp',
  // Jericho road — every bg by stem
  ...Object.fromEntries(JERICHO_BG.map((stem) => [stem, `${stem}.webp`])),
  // Battle character sprites, by archetype
  ...SPRITE_FILES,
}

/** Concrete URL for an AssetRef under the current base (e.g. "/assets/x.webp" or "/game/assets/x.webp"). */
export function resolveAsset(ref: string | undefined): string | undefined {
  const file = ref ? REGISTRY[ref] : undefined
  return file ? `${assetBase}assets/${file}` : undefined
}

/** CSS `background-image` value for an AssetRef, or undefined (caller applies a placeholder). */
export function assetBg(ref: string | undefined): string | undefined {
  const url = resolveAsset(ref)
  return url ? `url(${url})` : undefined
}
