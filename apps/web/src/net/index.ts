// Public surface of the co-op net layer. Components import actions from here; main.tsx calls initNet()
// once at boot to wire the game store's command transport.

export {
  initNet,
  openCoop,
  createParty,
  joinParty,
  chooseHero,
  setReady,
  startRun,
  sendChat,
  sendActivity,
  sendCinematic,
  leaveParty,
} from './client'
