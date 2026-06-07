// Resolve a public asset under the deployment base (so it works at "/" in dev and "/game/" in prod).
// Vite injects import.meta.env.BASE_URL = the configured `base` (always ends with "/").
export const ASSET_BASE = import.meta.env.BASE_URL

/** Absolute URL for a file in public/assets, base-aware. e.g. asset('bg-x.png') → "/game/assets/bg-x.png" */
export const asset = (file: string): string => `${ASSET_BASE}assets/${file}`

/** CSS `background-image` value for a public asset, base-aware. */
export const bgUrl = (file: string): string => `url(${asset(file)})`
