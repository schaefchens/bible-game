import { useMemo } from 'react'
import { useGame } from '../store/gameStore'
import { selectParty, selectPartyDeck, selectRunDeck } from '../selectors'
import { playerColor, playerSymbol } from '../lib/playerColors'
import { CardListModal, type ModalCard } from './CardListModal'

/** The top-bar Deck viewer. Single-player: the hero's run deck. Co-op: the COMBINED party deck (every
 *  member's cards, colored + labelled by owner) — the real shared draw pile. Mounted at the App root so
 *  the HUD button opens it from both the map and combat. */
export function DeckModal() {
  const state = useGame((s) => s.state)
  const mpMode = useGame((s) => s.mpMode)
  const setDeckOpen = useGame((s) => s.setDeckOpen)
  const party = useMemo(() => selectParty(state), [state])
  const combined = mpMode && party.length > 1

  const cards = useMemo<ModalCard[]>(() => {
    if (!combined) return selectRunDeck(state)
    const order = party.map((m) => m.memberId)
    return selectPartyDeck(state).map((c) => ({ ...c, ownerColor: playerColor(c.ownerId, order), ownerSymbol: playerSymbol(c.ownerId, order) }))
  }, [state, combined, party])
  const order = party.map((m) => m.memberId)
  const legend = combined ? party.map((m) => ({ name: m.name, color: playerColor(m.memberId, order), symbol: playerSymbol(m.memberId, order) })) : undefined

  return <CardListModal titleKey={combined ? 'ui.deck.partyTitle' : 'ui.deck.title'} cards={cards} legend={legend} onClose={() => setDeckOpen(false)} />
}
