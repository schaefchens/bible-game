import { z } from 'zod'
import type { ProfileState, RunState } from '@bible/engine'

// The SaveFile envelope is zod-validated on load (untrusted JSON from IndexedDB). The profile is
// validated structurally; run snapshots are validated shallowly (we produced them via the engine
// and they embed a large self-describing ContentBundle — deep mirroring would be brittle).

export const CURRENT_SCHEMA_VERSION = 2

const SettingsSchema = z.object({
  locale: z.enum(['en', 'de']),
  audioVolume: z.number().default(0.7),
  // .default() so saves written before these fields existed still validate (load uses .parse()).
  musicVolume: z.number().default(0.5),
  audioMode: z.enum(['on', 'sfxOnly', 'off']).default('on'),
  dynamicMusic: z.boolean().default(true),
  reducedMotion: z.boolean(),
  playStartupLogo: z.boolean().default(true),
})

const CharacterSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.number(),
  xp: z.number(),
  // Normalize on load: keep only the current allocatable stats (hp/dmg/defend), dropping any legacy keys
  // (maxHp/speed/attack/…) from older saves and defaulting any missing key to 0 (no NaN). Points are
  // derived from level minus these counts, so there is no separate unspentPoints field to persist.
  allocated: z
    .record(z.string(), z.number())
    .transform((a) => ({ hp: a.hp ?? 0, dmg: a.dmg ?? 0, defend: a.defend ?? 0 })),
  ownedVerseCardIds: z.array(z.string()),
  // .default(...) so saves written before verse-loss existed still validate (load uses .parse()).
  lostVerseCardIds: z.array(z.string()).default([]),
  verseAttempts: z.record(z.string(), z.number()).default({}),
  // .default([]) so saves written before the card pool existed still validate.
  pool: z.array(z.string()).default([]),
  createdSeq: z.number(),
  // Hero class. .default('shepherd') so pre-class saves validate AND those legacy pilgrims become the
  // durable Shepherd (the intended fallback). New heroes always persist their chosen class.
  classId: z.enum(['zealot', 'shepherd', 'merchant']).default('shepherd'),
})

const SlotSchema = z.object({ id: z.string(), character: CharacterSchema })

export const ProfileSchema = z.object({
  slots: z.array(SlotSchema),
  settings: SettingsSchema,
  lastSelectedId: z.string().nullable(),
  nextCreateSeq: z.number(),
  // .default([]) so saves written before world-gating existed still validate (load uses .parse()).
  completedWorlds: z.array(z.string()).default([]),
  // .default([]) so saves written before offline-download existed still validate.
  downloadedWorlds: z.array(z.string()).default([]),
})

// Run snapshots: validate just enough to trust the envelope; the body is engine-produced and
// embeds a large self-describing ContentBundle, so the rest passes through untouched.
const RunSchema = z.object({ seed: z.string(), worldId: z.string(), heroMemberId: z.string() }).passthrough()

export const SaveFileSchema = z.object({
  schemaVersion: z.number(),
  profile: ProfileSchema,
  runs: z.record(z.string(), RunSchema.nullable()),
})

// The authoritative type is the SaveFile interface below; zod validates the envelope structurally.
export type ValidatedProfile = ProfileState

export interface SaveFile {
  schemaVersion: number
  profile: ProfileState
  runs: Record<string, RunState | null>
}

export const emptySaveFile = (profile: ProfileState): SaveFile => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  profile,
  runs: {},
})
