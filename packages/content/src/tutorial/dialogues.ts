import type { Dialogue } from '@bible/engine'

// The shepherd guide. A controls-only walkthrough: how to travel the map, how a fight ACTUALLY works
// (draw a hand → spend energy on cards → attack or raise Block → read the foe's intent → pick a target →
// End Turn), how the hero grows (XP / levels / skill points), and that you rest at a fire to mend.
// STRICTLY mechanical — it must NEVER mention the Spirit/flesh system, grace, subduing vs. killing, or any
// "right way" to fight. The player figures that out for themselves. Text in @bible/i18n
// (dialogue.shepherdGuide.*). Battle is the deepest branch on purpose — it's what a new player needs most.

const shepherdGuide: Dialogue = {
  id: 'shepherdGuide',
  start: 'greet',
  speakerNameKey: 'dialogue.shepherdGuide.name',
  nodes: {
    greet: {
      id: 'greet',
      lines: ['dialogue.shepherdGuide.greet.line1'],
      choices: [
        { id: 'travel', textKey: 'dialogue.shepherdGuide.choice.travel', goto: 'travel' },
        { id: 'places', textKey: 'dialogue.shepherdGuide.choice.places', goto: 'places' },
        { id: 'fight', textKey: 'dialogue.shepherdGuide.choice.fight', goto: 'fight' },
        { id: 'grow', textKey: 'dialogue.shepherdGuide.choice.grow', goto: 'grow' },
        { id: 'rest', textKey: 'dialogue.shepherdGuide.choice.rest', goto: 'rest' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    travel: {
      id: 'travel',
      lines: ['dialogue.shepherdGuide.travel.line1'],
      choices: [
        { id: 'back', textKey: 'dialogue.shepherdGuide.choice.back', goto: 'greet' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    places: {
      id: 'places',
      lines: ['dialogue.shepherdGuide.places.line1', 'dialogue.shepherdGuide.places.line2', 'dialogue.shepherdGuide.places.line3'],
      choices: [
        { id: 'back', textKey: 'dialogue.shepherdGuide.choice.back', goto: 'greet' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    // Battle — the heart of the walkthrough. Overview first, then four sub-topics the player can dig into.
    fight: {
      id: 'fight',
      lines: ['dialogue.shepherdGuide.fight.line1', 'dialogue.shepherdGuide.fight.line2'],
      choices: [
        { id: 'energy', textKey: 'dialogue.shepherdGuide.choice.energy', goto: 'fightEnergy' },
        { id: 'defend', textKey: 'dialogue.shepherdGuide.choice.defend', goto: 'fightDefend' },
        { id: 'target', textKey: 'dialogue.shepherdGuide.choice.target', goto: 'fightTarget' },
        { id: 'danger', textKey: 'dialogue.shepherdGuide.choice.danger', goto: 'fightDanger' },
        { id: 'back', textKey: 'dialogue.shepherdGuide.choice.back', goto: 'greet' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    fightEnergy: {
      id: 'fightEnergy',
      lines: ['dialogue.shepherdGuide.energy.line1', 'dialogue.shepherdGuide.energy.line2', 'dialogue.shepherdGuide.energy.line3'],
      choices: [
        { id: 'more', textKey: 'dialogue.shepherdGuide.choice.moreBattle', goto: 'fight' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    fightDefend: {
      id: 'fightDefend',
      lines: ['dialogue.shepherdGuide.defend.line1', 'dialogue.shepherdGuide.defend.line2'],
      choices: [
        { id: 'more', textKey: 'dialogue.shepherdGuide.choice.moreBattle', goto: 'fight' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    fightTarget: {
      id: 'fightTarget',
      lines: ['dialogue.shepherdGuide.target.line1', 'dialogue.shepherdGuide.target.line2'],
      choices: [
        { id: 'more', textKey: 'dialogue.shepherdGuide.choice.moreBattle', goto: 'fight' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    fightDanger: {
      id: 'fightDanger',
      lines: ['dialogue.shepherdGuide.danger.line1', 'dialogue.shepherdGuide.danger.line2'],
      choices: [
        { id: 'more', textKey: 'dialogue.shepherdGuide.choice.moreBattle', goto: 'fight' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    grow: {
      id: 'grow',
      lines: ['dialogue.shepherdGuide.grow.line1', 'dialogue.shepherdGuide.grow.line2'],
      choices: [
        { id: 'back', textKey: 'dialogue.shepherdGuide.choice.back', goto: 'greet' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
    rest: {
      id: 'rest',
      lines: ['dialogue.shepherdGuide.rest.line1', 'dialogue.shepherdGuide.rest.line2'],
      choices: [
        { id: 'back', textKey: 'dialogue.shepherdGuide.choice.back', goto: 'greet' },
        { id: 'bye', textKey: 'dialogue.shepherdGuide.choice.bye' },
      ],
    },
  },
}

export const TUTORIAL_DIALOGUES: Record<string, Dialogue> = { shepherdGuide }
