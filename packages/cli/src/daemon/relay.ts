// The daemon's single outbound connection to the relay: a WebSocket to the Hub with reconnect + backoff.
// On every (re)connect it sends hello + a full snapshot, so the relay converges no matter what was missed.
// Pushes made while offline are queued briefly; everything else is state and gets re-sent by the snapshot.

import { PING, RelayMessage, randomId, type SourceMessage } from '@agentwatch/protocol'
import WebSocket from 'ws'
import type { Logger } from '../log.ts'

const PING_EVERY_MS = 30_000
const MAX_BACKOFF_MS = 60_000
const PUSH_QUEUE_MAX = 20
const PUSH_QUEUE_TTL_MS = 10 * 60_000

type WithoutRid<T> = T extends unknown ? Omit<T, 'rid'> : never
/** Messages the Hub acknowledges; `request` adds the `rid`. */
export type AckedMessage = WithoutRid<Extract<SourceMessage, { t: 'pair.create' | 'push' }>>

export interface AckResult {
  ok: boolean
  error?: string
}

export interface RelayLinkOptions {
  relayUrl: string
  sourceToken: string
  hello: () => SourceMessage
  snapshot: () => Promise<SourceMessage>
  onMessage: (msg: RelayMessage) => void
  onStatus?: (connected: boolean) => void
  log: Logger
}

export class RelayLink {
  private ws: WebSocket | null = null
  private open = false
  private backoff = 1000
  private stopped = false
  private pingTimer: NodeJS.Timeout | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private queuedPushes: { at: number; msg: SourceMessage }[] = []
  private pendingAcks = new Map<string, { resolve: (r: AckResult) => void; timer: NodeJS.Timeout }>()
  lastConnectedAt = 0
  lastError = ''

  constructor(private o: RelayLinkOptions) {}

  get connected(): boolean {
    return this.open
  }

  start(): void {
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close(1000, 'daemon stopping')
  }

  /** Reconnect now (e.g. after config change). */
  kick(): void {
    this.ws?.terminate()
  }

  private url(): string {
    const u = new URL('/api/source/ws', this.o.relayUrl)
    u.protocol = u.protocol === 'http:' ? 'ws:' : 'wss:'
    return u.toString()
  }

  private connect(): void {
    if (this.stopped) return
    const ws = new WebSocket(this.url(), {
      headers: { authorization: `Bearer ${this.o.sourceToken}` },
      handshakeTimeout: 15_000,
    })
    this.ws = ws
    ws.on('open', async () => {
      this.open = true
      this.backoff = 1000
      this.lastConnectedAt = Date.now()
      this.lastError = ''
      this.o.log('info', 'relay connected', { url: this.o.relayUrl })
      this.o.onStatus?.(true)
      this.rawSend(this.o.hello())
      this.rawSend(await this.o.snapshot())
      const cutoff = Date.now() - PUSH_QUEUE_TTL_MS
      for (const q of this.queuedPushes.splice(0)) if (q.at > cutoff) this.rawSend(q.msg)
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(PING)
      }, PING_EVERY_MS)
    })
    ws.on('message', (data) => {
      const text = data.toString()
      if (text === 'pong') return
      let msg: RelayMessage
      try {
        msg = RelayMessage.parse(JSON.parse(text))
      } catch {
        this.o.log('warn', 'bad relay message')
        return
      }
      if (msg.t === 'ack') {
        const p = this.pendingAcks.get(msg.rid)
        if (p) {
          clearTimeout(p.timer)
          this.pendingAcks.delete(msg.rid)
          p.resolve({ ok: msg.ok, ...(msg.error ? { error: msg.error } : {}) })
        }
        return
      }
      this.o.onMessage(msg)
    })
    ws.on('unexpected-response', (_req, res) => {
      this.lastError = `relay answered HTTP ${res.statusCode}`
      if (res.statusCode === 401)
        this.o.log('error', 'relay rejected this source token (401). Re-run `agentwatch setup`.')
    })
    ws.on('error', (e) => {
      this.lastError = e.message
      this.o.log('debug', 'relay socket error', { error: e.message })
    })
    ws.on('close', (code) => {
      const wasOpen = this.open
      this.open = false
      if (this.pingTimer) clearInterval(this.pingTimer)
      if (wasOpen) {
        this.o.log('info', 'relay disconnected', { code })
        this.o.onStatus?.(false)
      }
      if (this.stopped) return
      const delay = this.backoff + Math.floor(Math.random() * 500)
      this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS)
      this.retryTimer = setTimeout(() => this.connect(), delay)
    })
  }

  private rawSend(msg: SourceMessage): boolean {
    if (!this.open || this.ws?.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  /** Send state. If offline it's dropped: the next snapshot carries it. Pushes are queued briefly instead. */
  send(msg: SourceMessage): void {
    if (this.rawSend(msg)) return
    if (msg.t === 'push') {
      this.queuedPushes.push({ at: Date.now(), msg })
      if (this.queuedPushes.length > PUSH_QUEUE_MAX) this.queuedPushes.shift()
    }
  }

  /** Send a message the Hub acknowledges (pair.create, push with rid) and wait for the ack. */
  request(msg: AckedMessage, timeoutMs = 15_000): Promise<AckResult> {
    const rid = randomId(8)
    const full = { ...msg, rid } as SourceMessage
    return new Promise((resolve) => {
      if (!this.rawSend(full)) return resolve({ ok: false, error: 'not connected to the relay' })
      const timer = setTimeout(() => {
        this.pendingAcks.delete(rid)
        resolve({ ok: false, error: 'the relay did not answer' })
      }, timeoutMs)
      this.pendingAcks.set(rid, { resolve, timer })
    })
  }
}
