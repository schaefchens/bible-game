import type { ContentBundle } from './bundle'
import type { Script, ScriptCmd } from '../scene/types'

/** Follow the declarative script DSL, visiting every command (recursing into if/then/else). Mirrors
 *  the walker in @bible/content's validateContent so the enumerator stays in lockstep with authoring. */
function walkScript(script: Script | undefined, visit: (cmd: ScriptCmd) => void): void {
  if (!Array.isArray(script)) return
  for (const cmd of script) {
    visit(cmd)
    if ('if' in cmd) {
      walkScript(cmd.then, visit)
      walkScript(cmd.else, visit)
    }
  }
}

/**
 * Every AssetRef a single world/adventure needs, for offline pre-download. Returns base-agnostic refs
 * (the app maps them to URLs via @bible/assets and tolerates unknown ones — pure, no URL knowledge).
 *
 * Walks the world's map graph AND follows the script DSL TRANSITIVELY (startCombat / startEvent /
 * changeScene / startDialogue / startStory) into the shared content dictionaries — some assets (e.g. a
 * story reached only through a dialogue choice) are unreachable from `node.fixedEvent` alone.
 */
export function enumerateWorldAssetRefs(bundle: ContentBundle, worldId: string): string[] {
  const world = bundle.worlds[worldId]
  if (!world) return []
  const { map, ambushTable } = world

  const refs = new Set<string>()
  const add = (r: string | undefined): void => {
    if (r) refs.add(r)
  }

  // The hero sprite is in every fight; overworld music plays on the map (ducked/boosted by context).
  // NOTE: no current content adds a companion to the party, and `sprite/companion` has no art file
  // (it would render as an emoji), so warming it is skipped to avoid a guaranteed 404. If a companion
  // mechanic is introduced, enumerate its sprite from the party/encounter data at that point.
  add('sprite/hero')
  add(map.musicKey ?? 'music/map')

  // Reachable content ids, drained to a fixpoint below (a script command can reference more content).
  const encounters = new Set<string>()
  const scenes = new Set<string>()
  const events = new Set<string>()
  const dialogues = new Set<string>()
  const stories = new Set<string>()

  if (map.outroStoryId) stories.add(map.outroStoryId)
  if (ambushTable.combatEncounterId) encounters.add(ambushTable.combatEncounterId)
  if (ambushTable.eventId) events.add(ambushTable.eventId)

  for (const node of Object.values(map.nodes)) {
    add(node.bgAsset)
    add(node.musicKey)
    if (node.sceneId) scenes.add(node.sceneId)
    const fe = node.fixedEvent
    if (fe.kind === 'combat' || fe.kind === 'boss') encounters.add(fe.encounter)
    else if (fe.kind === 'scene') scenes.add(fe.sceneId)
    else if (fe.kind === 'event') events.add(fe.eventId)
    else if (fe.kind === 'dialogue') dialogues.add(fe.dialogueId)
    else if (fe.kind === 'story') stories.add(fe.storyId)
    // Rest/fireplace nodes can trigger the sleep + prayer cinematic cues (UI-driven, not in content).
    if (node.type === 'rest' || node.type === 'fireplace') {
      add('music/sleep')
      add('music/prayer')
    }
  }

  // A script command may reference more content — enqueue any newly-referenced ids for draining.
  const visit = (cmd: ScriptCmd): void => {
    if ('startCombat' in cmd) encounters.add(cmd.startCombat)
    if ('startEvent' in cmd) events.add(cmd.startEvent)
    if ('changeScene' in cmd) scenes.add(cmd.changeScene)
    if ('startDialogue' in cmd) dialogues.add(cmd.startDialogue)
    if ('startStory' in cmd) stories.add(cmd.startStory)
  }

  // Fixpoint: processing one kind can enqueue ids of another kind, so loop until nothing new appears.
  const doneEnc = new Set<string>()
  const doneScene = new Set<string>()
  const doneEvent = new Set<string>()
  const doneDlg = new Set<string>()
  const doneStory = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const id of [...encounters]) {
      if (doneEnc.has(id)) continue
      doneEnc.add(id)
      changed = true
      const enc = bundle.encounters[id]
      if (!enc) continue
      add(enc.battleBg)
      add(enc.rewardBg)
      add(enc.battleMusic)
      for (const e of enc.enemies) add(`sprite/${e.archetype}`)
    }
    for (const id of [...scenes]) {
      if (doneScene.has(id)) continue
      doneScene.add(id)
      changed = true
      const s = bundle.scenes[id]
      if (!s) continue
      add(s.bgAsset)
      add(s.ambientAsset)
      walkScript(s.onEnter, visit)
      for (const h of s.hotspots) {
        add(h.spriteAsset)
        for (const inter of Object.values(h.interactions)) walkScript(inter?.script, visit)
      }
    }
    for (const id of [...events]) {
      if (doneEvent.has(id)) continue
      doneEvent.add(id)
      changed = true
      const ev = bundle.events[id]
      if (!ev) continue
      add(ev.bgAsset)
      for (const ch of ev.choices) walkScript(ch.script, visit)
    }
    for (const id of [...dialogues]) {
      if (doneDlg.has(id)) continue
      doneDlg.add(id)
      changed = true
      const d = bundle.dialogues[id]
      if (!d) continue
      add(d.bgAsset)
      add(d.portraitAsset)
      for (const n of Object.values(d.nodes)) {
        walkScript(n.onEnter, visit)
        for (const ch of n.choices) walkScript(ch.script, visit)
      }
    }
    for (const id of [...stories]) {
      if (doneStory.has(id)) continue
      doneStory.add(id)
      changed = true
      const st = bundle.stories[id]
      if (!st) continue
      add(st.bgAsset)
      walkScript(st.onEnd, visit)
    }
  }

  return [...refs]
}
