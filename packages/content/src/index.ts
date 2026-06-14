// @bible/content — the real Milestone-2 content bundle: "The Jericho Road". Assembles the 22-node
// map / encounters / scenes / events / items / verses / cards into a ContentBundle the engine
// consumes, and validates referential + graph integrity (catches authoring mistakes the
// type-checker can't — a node pointing at a missing scene, an asymmetric edge, an out-of-range
// verse blank, an unreachable boss).

import type { ContentBundle } from '@bible/engine'
import { CARDS, CARD_POOL_START, CARD_UNLOCKS_BY_LEVEL, DECK_LIMIT, HERO_START_DECK } from './cards'
import { VERSES } from './verses'
import { AMBUSH_TABLE, ENCOUNTERS, ITEMS, WORLD_01_MAP } from './jericho/map'
import { SCENES } from './jericho/scenes'
import { EVENTS } from './jericho/events'
import { DIALOGUES } from './jericho/dialogues'
import { STORIES } from './jericho/stories'
import { TUTORIAL_AMBUSH_TABLE, TUTORIAL_ENCOUNTERS, TUTORIAL_MAP } from './tutorial/map'
import { TUTORIAL_DIALOGUES } from './tutorial/dialogues'
import { TUTORIAL_STORIES } from './tutorial/stories'
import { TUTORIAL_SCENES } from './tutorial/scenes'
import { ELAH_AMBUSH_TABLE, ELAH_ENCOUNTERS, ELAH_MAP } from './elah/map'
import { ELAH_STORIES } from './elah/stories'

const HERO_GRACE_ABILITIES = ['sight', 'mercy']

export function createContent(): ContentBundle {
  const bundle: ContentBundle = {
    heroStartDeck: HERO_START_DECK,
    heroGraceAbilities: HERO_GRACE_ABILITIES,
    cards: CARDS,
    cardPoolStart: CARD_POOL_START,
    cardUnlocksByLevel: CARD_UNLOCKS_BY_LEVEL,
    deckLimit: DECK_LIMIT,
    encounters: { ...ENCOUNTERS, ...TUTORIAL_ENCOUNTERS, ...ELAH_ENCOUNTERS },
    scenes: { ...SCENES, ...TUTORIAL_SCENES },
    events: EVENTS,
    dialogues: { ...DIALOGUES, ...TUTORIAL_DIALOGUES },
    stories: { ...STORIES, ...TUTORIAL_STORIES, ...ELAH_STORIES },
    items: ITEMS,
    verses: VERSES,
    worlds: {
      'world-02': { map: TUTORIAL_MAP, ambushTable: TUTORIAL_AMBUSH_TABLE },
      'world-01': { map: WORLD_01_MAP, ambushTable: AMBUSH_TABLE },
      'world-03': { map: ELAH_MAP, ambushTable: ELAH_AMBUSH_TABLE },
    },
  }
  validateContent(bundle)
  return bundle
}

/** Referential + graph integrity. Throws on an authoring error. */
export function validateContent(b: ContentBundle): void {
  const err = (m: string) => {
    throw new Error(`content: ${m}`)
  }

  for (const id of b.heroStartDeck) if (!b.cards[id]) err(`start deck references missing card "${id}"`)

  // card pool integrity: '+' targets and pool/unlock entries must resolve to real cards
  for (const c of Object.values(b.cards)) {
    if (c.upgradeTo && !b.cards[c.upgradeTo]) err(`card "${c.id}" upgradeTo references missing card "${c.upgradeTo}"`)
  }
  for (const id of b.cardPoolStart ?? []) if (!b.cards[id]) err(`cardPoolStart references missing card "${id}"`)
  for (const [lvl, ids] of Object.entries(b.cardUnlocksByLevel ?? {})) {
    for (const id of ids) if (!b.cards[id]) err(`cardUnlocksByLevel[${lvl}] references missing card "${id}"`)
  }

  for (const v of Object.values(b.verses)) {
    if (!b.cards[v.cardDefId]) err(`verse "${v.id}" references missing card "${v.cardDefId}"`)
    for (const loc of ['en', 'de'] as const) {
      const d = v.byLocale[loc]
      if (!d) err(`verse "${v.id}" missing locale "${loc}"`)
      if (d.blankIndices.some((i) => i < 0 || i >= d.tokens.length)) err(`verse "${v.id}" (${loc}) has an out-of-range blank index (a blanked word wasn't found in the text)`)
    }
  }

  for (const enc of Object.values(b.encounters)) {
    for (const o of enc.rewardOptions ?? []) {
      if (o.kind === 'relic' && o.defId && !b.items[o.defId]) err(`encounter "${enc.id}" rewards missing relic "${o.defId}"`)
    }
    // demons referenced by a human's revealsId must exist in the same encounter
    const ids = new Set(enc.enemies.map((e) => e.id))
    for (const e of enc.enemies) {
      if (e.revealsId && !ids.has(e.revealsId)) err(`encounter "${enc.id}" enemy "${e.id}" reveals missing "${e.revealsId}"`)
      if (e.boundToId && !ids.has(e.boundToId)) err(`encounter "${enc.id}" demon "${e.id}" bound to missing "${e.boundToId}"`)
    }
  }

  for (const [worldId, world] of Object.entries(b.worlds)) {
    const map = world.map
    if (!map.nodes[map.entrance]) err(`world "${worldId}" entrance "${map.entrance}" missing`)
    if (!map.nodes[map.bossId]) err(`world "${worldId}" boss "${map.bossId}" missing`)
    if (map.outroStoryId && !b.stories[map.outroStoryId]) err(`world "${worldId}" outro story "${map.outroStoryId}" missing`)
    // Every chooseable entry point must exist (defaults to [entrance] when unset).
    const entrances = map.entrances && map.entrances.length > 0 ? map.entrances : [map.entrance]
    for (const e of entrances) if (!map.nodes[e]) err(`world "${worldId}" entry "${e}" missing`)

    for (const node of Object.values(map.nodes)) {
      const fe = node.fixedEvent
      if ((fe.kind === 'combat' || fe.kind === 'boss') && !b.encounters[fe.encounter]) err(`node "${node.id}" references missing encounter "${fe.encounter}"`)
      if (fe.kind === 'scene' && !b.scenes[fe.sceneId]) err(`node "${node.id}" references missing scene "${fe.sceneId}"`)
      if (fe.kind === 'event' && !b.events[fe.eventId]) err(`node "${node.id}" references missing event "${fe.eventId}"`)
      if (fe.kind === 'dialogue' && !b.dialogues[fe.dialogueId]) err(`node "${node.id}" references missing dialogue "${fe.dialogueId}"`)
      if (fe.kind === 'story' && !b.stories[fe.storyId]) err(`node "${node.id}" references missing story "${fe.storyId}"`)
    }

    // edges reference existing nodes; adjacency is symmetric
    for (const edge of Object.values(map.edges)) {
      if (!map.nodes[edge.a] || !map.nodes[edge.b]) err(`edge "${edge.id}" references a missing node`)
      if (!map.adjacency[edge.a]?.includes(edge.id) || !map.adjacency[edge.b]?.includes(edge.id)) {
        err(`edge "${edge.id}" is not listed symmetrically in adjacency`)
      }
    }

    // boss reachable from every entry point (ignoring gates — they unlock during play), so no
    // chosen start can strand the pilgrim short of the boss.
    for (const start of entrances) {
      const seen = new Set<string>([start])
      const queue = [start]
      while (queue.length) {
        const cur = queue.shift()!
        for (const eid of map.adjacency[cur] ?? []) {
          const e = map.edges[eid]!
          const next = e.a === cur ? e.b : e.a
          if (!seen.has(next)) {
            seen.add(next)
            queue.push(next)
          }
        }
      }
      if (!seen.has(map.bossId)) err(`world "${worldId}" boss is unreachable from entry "${start}"`)
    }
  }

  // Dialogue integrity: start nodes + choice `goto`s resolve within their dialogue, and every
  // `startDialogue` reference (in scenes, events, or dialogues themselves) points at a real dialogue.
  const walkScript = (script: unknown, visit: (cmd: Record<string, unknown>) => void): void => {
    if (!Array.isArray(script)) return
    for (const cmd of script) {
      if (cmd && typeof cmd === 'object') {
        visit(cmd as Record<string, unknown>)
        walkScript((cmd as { then?: unknown }).then, visit)
        walkScript((cmd as { else?: unknown }).else, visit)
      }
    }
  }
  const checkScriptRefs = (script: unknown, where: string): void =>
    walkScript(script, (cmd) => {
      if ('startDialogue' in cmd && !b.dialogues[cmd.startDialogue as string]) {
        err(`${where} references missing dialogue "${String(cmd.startDialogue)}"`)
      }
      if ('startStory' in cmd && !b.stories[cmd.startStory as string]) {
        err(`${where} references missing story "${String(cmd.startStory)}"`)
      }
      if ('grantCard' in cmd && !b.cards[cmd.grantCard as string]) {
        err(`${where} references missing card "${String(cmd.grantCard)}"`)
      }
      if ('unlockCard' in cmd && !b.cards[cmd.unlockCard as string]) {
        err(`${where} references missing card "${String(cmd.unlockCard)}"`)
      }
    })

  for (const scene of Object.values(b.scenes)) {
    checkScriptRefs(scene.onEnter, `scene "${scene.id}" onEnter`)
    for (const h of scene.hotspots) {
      for (const [verb, inter] of Object.entries(h.interactions)) {
        checkScriptRefs(inter?.script, `scene "${scene.id}" hotspot "${h.id}" ${verb}`)
      }
    }
  }
  for (const ev of Object.values(b.events)) {
    for (const c of ev.choices) checkScriptRefs(c.script, `event "${ev.id}" choice "${c.id}"`)
  }
  for (const dlg of Object.values(b.dialogues)) {
    if (!dlg.nodes[dlg.start]) err(`dialogue "${dlg.id}" start node "${dlg.start}" missing`)
    for (const node of Object.values(dlg.nodes)) {
      checkScriptRefs(node.onEnter, `dialogue "${dlg.id}" node "${node.id}" onEnter`)
      for (const c of node.choices) {
        if (c.goto && !dlg.nodes[c.goto]) err(`dialogue "${dlg.id}" choice "${c.id}" goto "${c.goto}" missing`)
        checkScriptRefs(c.script, `dialogue "${dlg.id}" choice "${c.id}"`)
      }
    }
  }
  for (const story of Object.values(b.stories)) {
    if (story.paragraphs.length === 0) err(`story "${story.id}" has no paragraphs`)
    checkScriptRefs(story.onEnd, `story "${story.id}" onEnd`)
  }
}

export { CARDS, HERO_START_DECK } from './cards'
export { VERSES } from './verses'
export { ENCOUNTERS, ITEMS, WORLD_01_MAP, AMBUSH_TABLE } from './jericho/map'
export { SCENES } from './jericho/scenes'
export { EVENTS } from './jericho/events'
export { DIALOGUES } from './jericho/dialogues'
export { STORIES } from './jericho/stories'
export { TUTORIAL_MAP, TUTORIAL_ENCOUNTERS, TUTORIAL_AMBUSH_TABLE } from './tutorial/map'
export { TUTORIAL_DIALOGUES } from './tutorial/dialogues'
export { TUTORIAL_STORIES } from './tutorial/stories'
export { TUTORIAL_SCENES } from './tutorial/scenes'
export { ELAH_MAP, ELAH_ENCOUNTERS, ELAH_AMBUSH_TABLE } from './elah/map'
export { ELAH_STORIES } from './elah/stories'
