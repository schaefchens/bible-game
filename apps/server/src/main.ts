// Process entry: one WebSocket server for all co-op rooms. Each connection owns a Session; messages are
// routed to handlers, which drive the authoritative @bible/engine and broadcast. A periodic sweep drops
// idle, fully-disconnected rooms (v1 keeps everything in memory — no disk persistence).

import { WebSocketServer } from 'ws'
import { PORT, ROOM_TTL_MS, SERVER_BUILD_HASH, SERVER_CONTENT_HASH } from './env'
import { handleClose, handleMessage, type Session } from './handlers'
import { sweepIdleRooms } from './rooms'

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  const session: Session = {}
  ws.on('message', (data) => handleMessage(ws, typeof data === 'string' ? data : data.toString(), session))
  ws.on('close', () => handleClose(ws, session))
  // swallow low-level socket errors; the close handler performs the cleanup
  ws.on('error', () => {})
})

setInterval(() => sweepIdleRooms(Date.now(), ROOM_TTL_MS), 60_000)

// Both fingerprints, because the content hash is what clients are gated on and the sha is what a
// human can act on. `build=dev` here means git could not be read in the checkout, not that this is dev.
console.log(
  `[bible-coop] listening on :${PORT}  build=${SERVER_BUILD_HASH}  content=${SERVER_CONTENT_HASH.slice(0, 8)}`,
)
