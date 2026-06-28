import { CURRENT_SCHEMA_VERSION, SaveFileSchema, type SaveFile } from './schema'

// Ordered migration steps vN → vN+1. None exist yet (v1 is the first), but the chain is in place
// so a future breaking change adds one step + a frozen-fixture test. Unknown future versions are
// refused rather than silently corrupting a save.

type Migration = (raw: Record<string, unknown>) => Record<string, unknown>

// v1→v2: the flesh buff/effect/power cards were renamed to plain ids that match their display names.
// Remap any persisted old card id (in run decks, the hero pool, shop stock, …) to its new id.
const CARD_ID_RENAMES: Record<string, string> = {
  plague_boils: 'venom',
  swarm_locusts: 'miasma',
  affliction: 'expose',
  hardened_heart: 'cripple',
  bind_strongman: 'shackle',
  belt_of_truth: 'menace',
  breastplate: 'bulwark',
  shield_of_faith: 'bastion',
  helmet_salvation: 'momentum',
  sword_of_spirit: 'whetstone',
  gospel_shod: 'adrenaline',
  zeal: 'fury',
  temperance: 'embolden',
  outstretched_hand: 'rupture',
  body_of_christ: 'shield_bash',
  cheerful_giver: 'foresight',
}

/** Deep-walk a save, replacing any string that exactly matches a renamed card id (path-agnostic, so it
 *  catches deckByMember, the hero pool, shop states, etc.). Object keys are left untouched. */
function remapCardIds(v: unknown): unknown {
  if (typeof v === 'string') return CARD_ID_RENAMES[v] ?? v
  if (Array.isArray(v)) return v.map(remapCardIds)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = remapCardIds(val)
    return out
  }
  return v
}

const MIGRATIONS: Record<number, Migration> = {
  1: (raw) => ({ ...(remapCardIds(raw) as Record<string, unknown>), schemaVersion: 2 }),
}

export function migrateSave(raw: unknown): SaveFile {
  if (!raw || typeof raw !== 'object') throw new Error('save: not an object')
  let cur = raw as Record<string, unknown>
  let version = typeof cur.schemaVersion === 'number' ? cur.schemaVersion : 0

  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`save: version ${version} is newer than supported ${CURRENT_SCHEMA_VERSION}`)
  }
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) throw new Error(`save: no migration from version ${version}`)
    cur = step(cur)
    version = cur.schemaVersion as number
  }

  return SaveFileSchema.parse(cur) as unknown as SaveFile
}
