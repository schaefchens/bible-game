// Verse importer (dev tool — NOT part of the game runtime). Fetches public-domain verse text and
// prints it as normalized JSON for authoring VerseChallenge content. The four shipped verses are
// hand-authored in @bible/content (src/verses.ts); this script is the path to scale that up.
//
// Sources (public domain):
//   - KJV (English):       https://github.com/aruljohn/Bible-kjv  (per-book JSON, MIT repo)
//   - Luther 1912 (German): https://api.getbible.net/v2/luther1912/<book>/<chapter>.json
//
// Usage:  node packages/i18n/scripts/importVerses.mjs "Philippians 4:6" "Zechariah 4:6"
// Output: JSON to stdout — copy the relevant text into a VerseChallenge (choose blank indices).

const KJV_BASE = 'https://raw.githubusercontent.com/aruljohn/Bible-kjv/master'
const LUTHER_BASE = 'https://api.getbible.net/v2/luther1912'

// Minimal book-name → getBible numeric id is omitted here; this skeleton fetches KJV only and
// leaves Luther as a documented manual step (the getBible v2 path uses book numbers per its index).
async function fetchKjvVerse(book, chapter, verse) {
  const res = await fetch(`${KJV_BASE}/${encodeURIComponent(book)}.json`)
  if (!res.ok) throw new Error(`KJV fetch failed for ${book}: ${res.status}`)
  const data = await res.json()
  const ch = data.chapters?.find((c) => Number(c.chapter) === chapter)
  const v = ch?.verses?.find((x) => Number(x.verse) === verse)
  return v?.text
}

function parseRef(ref) {
  const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/)
  if (!m) throw new Error(`bad reference "${ref}" — expected e.g. "Philippians 4:6"`)
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) }
}

async function main() {
  const refs = process.argv.slice(2)
  if (refs.length === 0) {
    console.error('Usage: node importVerses.mjs "Book C:V" ["Book C:V" ...]')
    process.exit(1)
  }
  const out = []
  for (const ref of refs) {
    const { book, chapter, verse } = parseRef(ref)
    const kjv = await fetchKjvVerse(book, chapter, verse)
    out.push({
      reference: ref,
      en: { translation: 'KJV', text: kjv ?? null, source: 'aruljohn/Bible-kjv' },
      de: { translation: 'LUTHER1912', text: null, source: `${LUTHER_BASE} (fetch by getBible book number)` },
    })
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
