// Process entry: one WebSocket server for all co-op rooms. Each connection owns a Session; messages are
// routed to handlers, which drive the authoritative @bible/engine and broadcast. A periodic sweep drops
// idle, fully-disconnected rooms (v1 keeps everything in memory — no disk persistence).

import { WebSocketServer } from 'ws'
import { PORT, ROOM_TTL_MS, SERVER_BUILD_HASH } from './env'
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

console.log(`[bible-coop] listening on :${PORT}  build=${SERVER_BUILD_HASH}`)
