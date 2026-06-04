// Grace abilities are a fixed hero KIT (not cards), spending a dedicated `grace` resource so they
// never compete for card energy. Grace flows FROM walking in the Spirit; using it nudges Spirit up.
// Milestone 1 ships Sight (reveal the demon behind a human — 2 Kings 6:17 / Eph 6:12) and
// Mercy/Stay-the-Hand (subdue a human without killing — Luke 6:36), which together complete the
// thief encounter righteously. Intercede / Bind-Loose are authored for a later milestone.

import type { GraceAbilityId, I18nKey } from '../types'

export interface GraceAbilityMeta {
  id: GraceAbilityId
  costGrace: number
  nameKey: I18nKey
  descKey: I18nKey
  scriptureRef: string
  /** what the ability needs to target */
  target: 'humanEnemy' | 'enemy' | 'none'
}

export const GRACE_ABILITIES: Record<GraceAbilityId, GraceAbilityMeta> = {
  sight: {
    id: 'sight',
    costGrace: 1,
    nameKey: 'grace.sight.name',
    descKey: 'grace.sight.desc',
    scriptureRef: '2 Kings 6:17',
    target: 'none',
  },
  mercy: {
    id: 'mercy',
    costGrace: 0,
    nameKey: 'grace.mercy.name',
    descKey: 'grace.mercy.desc',
    scriptureRef: 'Luke 6:36',
    target: 'humanEnemy',
  },
}

export const getGrace = (id: GraceAbilityId): GraceAbilityMeta | undefined => GRACE_ABILITIES[id]
