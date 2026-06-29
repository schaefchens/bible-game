// Ordered logo cards for the studio-logo intro (StartupSequence). Each card renders as a styled CSS
// card by default; if `assetRef` resolves to a real graphic registered in @bible/assets, the card is
// replaced by that image — the same image-or-fallback pattern the battle sprites use. To swap a card
// for art, drop a PNG/WEBP into apps/web/public/assets and register the ref there; no code change.
//
// `stings` are SFX keys fired as a card fades in (gated/scaled like all SFX). A missing sound file is
// a safe no-op in sfxManager, so the intro works with or without the audio assets present.

export interface LogoSting {
  /** asset ref of the sound, e.g. 'sfx/logo-whoosh' */
  key: string
  /** ms after the card appears before this sting fires (default 0 = on appear) */
  delayMs?: number
  /** per-sound gain 0..1 (default 1) */
  gain?: number
}

/** Look of the styled fallback card (used when no graphic is registered for the ref). */
export type LogoVariant = 'studio' | 'divine' | 'plain'

/** How a real graphic is presented.
 *  'feather' = a self-contained logo on a LIGHT background, melted into the black via a soft edge mask.
 *  'bleed'   = a cinematic graphic already on a DARK background, shown large/full-bleed (no mask).
 *  'plain'   = a transparent logo/wordmark shown as-is (no mask/frame), modest size + drop shadow.
 *  'framed'  = a rounded, bordered card (for portraits/photos that need a frame + a text caption). */
export type ImageTreatment = 'feather' | 'bleed' | 'plain' | 'framed'

export interface LogoCard {
  id: string
  /** asset ref for a real graphic; when it resolves the image replaces the styled card */
  assetRef?: string
  /** how the graphic is shown when present */
  imageTreatment?: ImageTreatment
  /** show the text caption/tagline even when the graphic renders (false for self-captioning logos) */
  captionWithImage?: boolean
  /** i18n key for the main caption (used for the styled card, and the image card iff captionWithImage) */
  captionKey: string
  /** optional i18n key for a small line shown above the caption (e.g. "presents") */
  taglineKey?: string
  /** optional non-translated line under the caption (a Latin motto, a URL, …) */
  subcaption?: string
  /** glyph shown big on the styled fallback card */
  glyph: string
  variant: LogoVariant
  stings: LogoSting[]
}

// Order (confirmed with the studio): Lamm Media → To the Glory of God → Claude AI → Misselle.
export const LOGO_CARDS: LogoCard[] = [
  {
    id: 'lamm',
    assetRef: 'logo/lamm', // self-contained illustration (lamb + "LAMM MEDIA · GAME STUDIO" wordmark)
    imageTreatment: 'feather',
    captionWithImage: false, // the artwork already carries its own wordmark
    captionKey: 'ui.startup.caption.lamm',
    taglineKey: 'ui.startup.tagline.lamm',
    glyph: '🐑',
    variant: 'studio',
    stings: [
      { key: 'sfx/logo-whoosh' },
      { key: 'sfx/logo-sheep', delayMs: 380, gain: 0.85 },
    ],
  },
  {
    id: 'god',
    assetRef: 'logo/god', // "Grace Guided · To God Be The Glory" — cinematic art, already on dark/gold
    imageTreatment: 'bleed',
    captionWithImage: false, // the artwork carries its own dedication text
    captionKey: 'ui.startup.caption.god',
    subcaption: 'Soli Deo Gloria',
    glyph: '✝',
    variant: 'divine',
    stings: [{ key: 'sfx/logo-whoosh-soft', gain: 0.6 }],
  },
  {
    id: 'claude',
    assetRef: 'logo/claude', // the official Claude wordmark (transparent SVG) — caption adds context
    imageTreatment: 'plain',
    captionWithImage: true,
    captionKey: 'ui.startup.caption.claude',
    glyph: '✦',
    variant: 'plain',
    stings: [{ key: 'sfx/logo-whoosh' }],
  },
  {
    id: 'misselle',
    assetRef: 'logo/misselle', // ships a real graphic (portrait illustration)
    imageTreatment: 'framed',
    captionWithImage: true,
    captionKey: 'ui.startup.caption.misselle',
    subcaption: 'misselle.live',
    glyph: '♪',
    variant: 'plain',
    stings: [{ key: 'sfx/logo-ding' }],
  },
]

/** Unique sting keys across all cards — preloaded so the first one isn't delayed by a fetch/decode. */
export const LOGO_STING_KEYS: string[] = [...new Set(LOGO_CARDS.flatMap((c) => c.stings.map((s) => s.key)))]
