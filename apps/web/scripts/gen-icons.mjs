// Generate the PWA / favicon icon set from the authored app-icon artwork in files/ — the gold
// shepherd's crook over a seedling, flanked by the dagger and the coin stack (Zealot, Shepherd,
// Merchant) on the green field. Run on demand; outputs are committed to public/:
//   npm run gen:icons --workspace @bible/web
// This file is excluded from tsc/lint (scripts/**, *.mjs), so it never touches typecheck/CI.
import sharp from 'sharp'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

// The one source of truth for the icon. Re-export over it (any size, the rounded tile on
// transparency) and re-run this script — nothing below is hardcoded to its pixel dimensions.
const SRC = fileURLToPath(new URL('../../../files/app-icon.png', import.meta.url))

const OUT = new URL('../public/', import.meta.url)
const outPath = (name) => fileURLToPath(new URL(name, OUT))

// Quantised PNG: the artwork is smooth gradients over few hues, so a palette is indistinguishable
// from full colour here and about five times smaller (pwa-512: 92 KB instead of 455 KB).
const PNG = { palette: true, quality: 100, effort: 10 }

/**
 * Crop the transparent margin off the artwork so every output below starts from a square whose
 * edges ARE the icon's edges. The alpha≥200 threshold leaves the soft drop shadow behind: it is
 * part of the mockup, not of the icon.
 */
async function loadTile() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] < 200) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (maxX < 0) throw new Error(`${SRC} has no opaque pixels`)
  // Grow the crop back to a square around its own centre, so nothing is squashed on resize.
  const side = Math.max(maxX - minX + 1, maxY - minY + 1)
  const left = Math.min(Math.max(0, Math.round(minX + (maxX - minX + 1 - side) / 2)), width - side)
  const top = Math.min(Math.max(0, Math.round(minY + (maxY - minY + 1 - side) / 2)), height - side)
  console.log(`  source ${width}×${height} → tile ${side}×${side} at ${left},${top}`)
  return sharp(SRC).ensureAlpha().extract({ left, top, width: side, height: side }).png().toBuffer()
}

/** Mean colour of the artwork's opaque border — the dark green its vignette fades out to. */
async function fieldColour(tile) {
  const { data, info } = await sharp(tile).resize(256, 256).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true })
  const { width, channels } = info
  const band = Math.round(width * 0.03)
  let r = 0, g = 0, b = 0, n = 0
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= band && y >= band && x < width - band && y < width - band) continue
      const i = (y * width + x) * channels
      if (data[i + 3] < 200) continue
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++
    }
  }
  const colour = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) }
  console.log(`  field colour rgb(${colour.r},${colour.g},${colour.b})`)
  return colour
}

/** The artwork as authored: rounded corners, transparent outside them. */
function renderAny(tile, size) {
  return sharp(tile).resize(size, size).png(PNG).toBuffer()
}

/**
 * A square with no transparency anywhere, for the platforms that apply their OWN mask (Android
 * adaptive icons, iOS home screen) — hand either one transparency and it composites the gaps onto
 * black. `inset` shrinks the artwork towards the centre; whatever it leaves bare is filled so that
 * the green field looks like it simply continues past the artwork's edge:
 *  - the ring around the artwork repeats its border pixels outwards (softened, so the starburst
 *    rays fan out instead of banding), and
 *  - the corners — which no straight repeat can reach, since the artwork's own corners are round —
 *    take a heavy blur of the artwork over the flat field colour, continuing the vignette.
 */
async function renderFullBleed(tile, size, inset, field) {
  const art = Math.round(size * inset)
  const pad = Math.round((size - art) / 2)
  const scaled = await sharp(tile).resize(art, art).toBuffer()
  const positioned = await sharp({
    create: { width: size, height: size, channels: 4, background: { ...field, alpha: 0 } },
  }).composite([{ input: scaled, left: pad, top: pad }]).png().toBuffer()
  const haze = await sharp(positioned).blur(size * 0.1).toBuffer()
  const layers = [
    // Three passes of the same translucent haze, to build the corners up to full opacity.
    { input: haze }, { input: haze }, { input: haze },
  ]
  if (pad > 0) {
    layers.push({
      input: await sharp(await sharp(scaled)
        .extend({ top: pad, bottom: size - art - pad, left: pad, right: size - art - pad, extendWith: 'copy' })
        .toBuffer())
        .blur(size / 26)
        .toBuffer(),
    })
  }
  layers.push({ input: scaled, left: pad, top: pad })
  return sharp({ create: { width: size, height: size, channels: 3, background: field } })
    .composite(layers)
    .png(PNG)
    .toBuffer()
}

// Wrap a PNG in a single-image .ico container (Vista+ accepts PNG-compressed entries).
function pngToIco(pngBuf, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count
  const dir = Buffer.alloc(16)
  dir.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 ⇒ 256)
  dir.writeUInt8(size >= 256 ? 0 : size, 1) // height
  dir.writeUInt8(0, 2) // palette
  dir.writeUInt8(0, 3) // reserved
  dir.writeUInt16LE(1, 4) // color planes
  dir.writeUInt16LE(32, 6) // bits per pixel
  dir.writeUInt32LE(pngBuf.length, 8) // bytes in image
  dir.writeUInt32LE(22, 12) // offset (6 + 16)
  return Buffer.concat([header, dir, pngBuf])
}

async function write(name, buf) {
  await writeFile(outPath(name), buf)
  console.log('  wrote', name, `(${(buf.length / 1024).toFixed(1)} KB)`)
}

console.log('Generating PWA icons → apps/web/public/')
const tile = await loadTile()
const field = await fieldColour(tile)
await write('pwa-192.png', await renderAny(tile, 192))
await write('pwa-512.png', await renderAny(tile, 512))
// 0.84: the dagger's tip and the coins sit ~8% and ~90% across the artwork, which the circular mask
// Android may apply would clip. Shrunk this far they land at 15%/84% — inside the safe zone.
await write('maskable-512.png', await renderFullBleed(tile, 512, 0.84, field))
// iOS masks this one itself, with a rounded square rather than a circle, so it keeps its full size.
await write('apple-touch-icon.png', await renderFullBleed(tile, 180, 1, field))
// A touch of sharpening: three gold shapes on a vignette turn to mush at 32px without it.
const fav32 = await sharp(tile).resize(32, 32).sharpen({ sigma: 0.6 }).png(PNG).toBuffer()
await write('favicon-32.png', fav32)
await write('favicon.ico', pngToIco(fav32, 32))
console.log('Done.')
