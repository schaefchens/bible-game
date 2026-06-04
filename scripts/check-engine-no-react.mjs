// Fails CI if the engine package's source imports React, other UI/storage deps, or any
// internal @bible/* package. This is the machine-enforced half of the "engine is pure and
// standalone" invariant (the other half is the ESLint boundary rule).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const engineSrc = fileURLToPath(new URL('../packages/engine/src/', import.meta.url))
const enginePkg = fileURLToPath(new URL('../packages/engine/package.json', import.meta.url))

const FORBIDDEN_IMPORT =
  /\bfrom\s+['"](react|react-dom|zustand|framer-motion|i18next|react-i18next|idb-keyval|@bible\/)/

const offenders = []

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(entry)) {
      const src = readFileSync(p, 'utf8')
      const m = src.match(FORBIDDEN_IMPORT)
      if (m) offenders.push(`${p} → ${m[1]}`)
    }
  }
}

if (existsSync(engineSrc)) walk(engineSrc)

// Also assert the engine declares no forbidden dependencies.
const pkg = JSON.parse(readFileSync(enginePkg, 'utf8'))
const deps = { ...(pkg.dependencies ?? {}), ...(pkg.peerDependencies ?? {}) }
const forbiddenDeps = Object.keys(deps).filter(
  (d) => /^(react|react-dom|zustand|framer-motion|i18next|react-i18next|idb-keyval)$/.test(d) || d.startsWith('@bible/'),
)
for (const d of forbiddenDeps) offenders.push(`${enginePkg} declares dependency "${d}"`)

if (offenders.length) {
  console.error('\n✗ Engine purity violation — the engine must be pure & standalone:\n')
  for (const o of offenders) console.error('  - ' + o)
  console.error('')
  process.exit(1)
}
console.log('✓ Engine is pure: no React / UI / storage / internal-package imports.')
