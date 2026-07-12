// Public surface of the co-op net layer. Components import actions from here; main.tsx calls initNet()
// once at boot to wire the game store's command transport.

export {
  initNet,
  openCoop,
  reconnectCoop,
  cancelServerResolve,
  createParty,
  joinParty,
  joinRun,
  joinDecision,
  lookForMore,
  setRoomTitle,
  listGames,
  chooseHero,
  setReady,
  kick,
  startRun,
  sendChat,
  sendActivity,
  sendPick,
  sendCinematic,
  leaveParty,
} from './client'
