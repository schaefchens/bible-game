// A thin WebSocket wrapper with automatic reconnect (capped backoff). Frames are JSON. Ordering and
// delivery come free from the single TCP connection, so there is no ack/seq bookkeeping here (see the
// plan's cut-list) — just connect, send, and reconnect-on-drop.

import type { ClientMsg, ServerMsg } from './protocol'

export interface SocketHooks {
  onOpen: () => void
  onMessage: (msg: ServerMsg) => void
  onClose: () => void
}

export class Socket {
  private ws: WebSocket | null = null
  private shouldRun = false
  private retry = 0
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly url: string,
    private readonly hooks: SocketHooks,
  ) {}

  connect(): void {
    this.shouldRun = true
    this.open()
  }

  private open(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.hooks.onOpen()
    }
    ws.onmessage = (e) => {
      try {
        this.hooks.onMessage(JSON.parse(e.data as string) as ServerMsg)
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onclose = () => {
      this.hooks.onClose()
      if (this.shouldRun) this.scheduleReconnect()
    }
    ws.onerror = () => {
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(5000, 500 * 2 ** this.retry++)
    this.timer = setTimeout(() => this.open(), delay)
  }

  send(msg: ClientMsg): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
      return true
    }
    return false
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }

  close(): void {
    this.shouldRun = false
    if (this.timer) clearTimeout(this.timer)
    this.ws?.close()
    this.ws = null
  }
}
