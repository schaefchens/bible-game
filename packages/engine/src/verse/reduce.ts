import { canAddCopy } from '../cards/pool'
import type { Command } from '../commands/command'
import type { GameEvent, ReduceResult } from '../events/event'
import { applySpiritEvent } from '../spirit/spirit'
import type { Character } from '../state/character'
import type { GameState } from '../state/gameState'
import { checkVerseAnswers } from './verseGapFill'

const reject = (state: GameState, reason: string): ReduceResult => ({ state, events: [{ type: 'rejected', reason }] })

/** How many times the player may submit a wrong answer before the scripture piece is lost. */
export const MAX_VERSE_ATTEMPTS = 3

/**
 * Verse gap-fill sub-reducer. Validates the player's words against the real verse (current locale).
 * On success the verse card materializes into the permanent collection + the run deck and Spirit
 * rises (earnVerse). On a wrong answer the player keeps trying — but only MAX_VERSE_ATTEMPTS times:
 * the 3rd miss LOSES the scripture (recorded permanently so it is no longer offered when studying;
 * must be re-acquired later). The miss count lives on the CHARACTER (verseAttempts), not the
 * transient prompt — so cancelling the modal (verse/cancel) and re-studying RESUMES the count rather
 * than handing out a fresh 3. Cancelling itself spends no attempt; only wrong submissions do.
 */
export function reduceVerse(state: GameState, cmd: Command): ReduceResult {
  const run = state.run
  if (!run) return reject(state, 'no-run')
  if (state.prompt?.kind !== 'verseChallenge') return reject(state, 'no-active-verse-challenge')

  // cancel: just close the modal — no attempt spent; verseAttempts already holds prior misses
  if (cmd.type === 'verse/cancel') {
    return { state: { ...state, prompt: null }, events: [] }
  }
  if (cmd.type !== 'verse/submit') return reject(state, 'unknown-verse-command')
  if (state.prompt.challengeId !== cmd.challengeId) return reject(state, 'no-active-verse-challenge')

  const challengeId = cmd.challengeId
  const challenge = run.content.verses[challengeId]
  if (!challenge) return reject(state, 'no-such-challenge')

  const cardId = challenge.cardDefId
  const characterId = run.party.find((m) => m.memberId === run.heroMemberId)?.characterId
  const idx = state.profile.slots.findIndex((s) => s.id === characterId)
  const slot = state.profile.slots[idx]
  const patchCharacter = (patch: Partial<Character>): GameState['profile'] =>
    slot ? { ...state.profile, slots: state.profile.slots.map((s, i) => (i === idx ? { ...s, character: { ...s.character, ...patch } } : s)) } : state.profile

  const locale = state.profile.settings.locale
  const data = challenge.byLocale[locale]
  const result = checkVerseAnswers(data, locale, cmd.answers)

  // the Scripture Fragment being studied (carried on the prompt) — consumed on success OR on loss
  const fragmentId = state.prompt.fragmentId
  const takeFragment = (r: typeof run): typeof run => {
    const left = Math.max(0, (r.inventory.stacks[fragmentId] ?? 0) - 1)
    return { ...r, inventory: { ...r.inventory, stacks: { ...r.inventory.stacks, [fragmentId]: left } } }
  }

  if (!result.correct) {
    const attempts = (slot?.character.verseAttempts[cardId] ?? 0) + 1
    const verseAttempts = { ...(slot?.character.verseAttempts ?? {}), [cardId]: attempts }
    if (attempts < MAX_VERSE_ATTEMPTS) {
      // still tries left: persist the miss, keep the modal open
      return { state: { ...state, profile: patchCharacter({ verseAttempts }) }, events: [{ type: 'verseRejected', challengeId, attemptsLeft: MAX_VERSE_ATTEMPTS - attempts }] }
    }
    // out of tries: the FRAGMENT falls to pieces (the item is destroyed) — no permanent card-lock; a
    // fresh fragment can be found/bought to try again. Clear the dead attempt count + close the modal.
    const verseAttemptsCleared = { ...(slot?.character.verseAttempts ?? {}) }
    delete verseAttemptsCleared[cardId]
    return {
      state: { ...state, profile: patchCharacter({ verseAttempts: verseAttemptsCleared }), run: takeFragment(run), prompt: null },
      events: [
        { type: 'verseLost', challengeId, cardDefId: cardId },
        { type: 'notice', messageKey: 'fireplace.fragmentDestroyed' },
      ],
    }
  }

  // per-card copy cap: spirit cards are once-per-run by default, so if the run deck already holds the
  // maximum copies, refuse the study and KEEP the fragment (not consumed). Close the modal + notice.
  const deckNow = run.deckByMember[run.heroMemberId] ?? []
  if (!canAddCopy(run.content, deckNow, cardId)) {
    return { state: { ...state, prompt: null }, events: [{ type: 'notice', messageKey: 'verse.atMax' }] }
  }

  // success: record the card on the permanent character (lifetime + pool) AND drop a copy into THIS
  // run's deck; consume the fragment; raise Spirit; clear the attempt count.
  let profile = state.profile
  if (slot) {
    const has = (xs: string[]) => xs.includes(cardId)
    const ownedVerseCardIds = has(slot.character.ownedVerseCardIds) ? slot.character.ownedVerseCardIds : [...slot.character.ownedVerseCardIds, cardId]
    const pool = has(slot.character.pool) ? slot.character.pool : [...slot.character.pool, cardId]
    const verseAttempts = { ...slot.character.verseAttempts }
    delete verseAttempts[cardId]
    profile = patchCharacter({ ownedVerseCardIds, pool, verseAttempts })
  }

  // Append a copy to this run's deck. The copy cap was checked above (spirit cards are once-per-run by
  // default), so this never pushes a copy past the card's `maxCopies`.
  const deckByMember = { ...run.deckByMember, [run.heroMemberId]: [...deckNow, cardId] }

  const out = applySpiritEvent(run.spirit, { kind: 'earnVerse' })
  const newRun = { ...takeFragment(run), deckByMember, spirit: out.state }

  const events: GameEvent[] = [
    { type: 'verseEarned', cardDefId: cardId },
    { type: 'cardUnlocked', cardId },
    { type: 'spiritShifted', delta: out.delta, reason: out.reason },
  ]
  return { state: { ...state, profile, run: newRun, prompt: null }, events }
}
