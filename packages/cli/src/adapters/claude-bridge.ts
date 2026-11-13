// Phone replies into Claude Code. The plugin's mod long-polls `GET /v1/bridge/claude` for its session over the daemon's
// unix socket, submits each message with `$.prompt.submit({ text, asUser: true })` and acks it. A session counts as
// connected for replies while its mod keeps polling. A mod that polls with `v=2` can take a reply while Claude works:
// Claude queues it as the next turn, and the mod acks `queued` at once instead of when the turn ends.

import { randomId } from '@agentwatch/protocol'
import type { Delivery } from '../daemon/core.ts'

export type { Delivery }

export const POLL_MS = 25_000
/** A link with no poll for this long is gone (the mod polls again right after each answer). */
const STALE_MS = POLL_MS + 15_000
/** How long the phone waits to hear that Claude took the message. */
const ACK_MS = 30_000

export interface BridgeMessage {
  id: string
  text: string
}

interface Waiting {
  msg: BridgeMessage
  done: (d: Delivery) => void
}

interface Link {
  /** The mod loop that owns this session. After a plugin reload a new loop takes over and the old one is told to stop. */
  loop: string
  loops: Set<string>
  poll: ((msgs: BridgeMessage[]) => void) | null
  lastPoll: number
  /** The polling mod can queue a reply while Claude works (it acks `queued` instead of waiting for the turn). */
  queues: boolean
  reported: boolean
  reportedQueues: boolean
  queued: Waiting[]
  inFlight: Map<string, Waiting>
}

export interface BridgeOptions {
  /** Called when a session's mod connects or goes away. */
  onLink(sessionId: string, connected: boolean): void
  now?: () => number
}

export class ClaudeBridge {
  private links = new Map<string, Link>()
  private sweeper: NodeJS.Timeout

  constructor(private o: BridgeOptions) {
    this.sweeper = setInterval(() => this.sweep(), 5_000)
    this.sweeper.unref()
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  connected(sessionId: string): boolean {
    const l = this.links.get(sessionId)
    return !!l && (l.poll !== null || this.now() - l.lastPoll < STALE_MS)
  }

  /** Whether this session's mod can take a reply while Claude works. Older mods can't. */
  queues(sessionId: string): boolean {
    return this.connected(sessionId) && !!this.links.get(sessionId)?.queues
  }

  /**
   * One long-poll from a mod loop. Resolves with the messages to submit (empty when the poll timed out or the mod
   * went away), or `superseded` when a newer loop owns this session.
   */
  poll(
    sessionId: string,
    loop: string,
    signal?: AbortSignal,
    o: { queues?: boolean } = {},
  ): Promise<BridgeMessage[] | 'superseded'> {
    let l = this.links.get(sessionId)
    if (!l) {
      l = {
        loop,
        loops: new Set([loop]),
        poll: null,
        lastPoll: 0,
        queues: false,
        reported: false,
        reportedQueues: false,
        queued: [],
        inFlight: new Map(),
      }
      this.links.set(sessionId, l)
    } else if (l.loop !== loop) {
      if (l.loops.has(loop)) return Promise.resolve('superseded')
      l.loops.add(loop)
      l.loop = loop
      l.poll?.([])
    }
    const link = l
    link.lastPoll = this.now()
    link.queues = o.queues === true
    this.report(sessionId, link)
    if (link.queued.length) return Promise.resolve(this.take(link))
    return new Promise((resolve) => {
      const finish = (msgs: BridgeMessage[]) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (link.poll === finish) link.poll = null
        link.lastPoll = this.now()
        resolve(msgs)
      }
      const onAbort = () => finish([])
      const timer = setTimeout(() => finish([]), POLL_MS)
      signal?.addEventListener('abort', onAbort, { once: true })
      link.poll = finish
    })
  }

  /**
   * The mod's report that it submitted (or failed to submit) a message. `queued`: Claude is mid-turn and took it as
   * its next prompt.
   */
  ack(sessionId: string, id: string, ok: boolean, error?: string, queued?: boolean): boolean {
    const w = this.links.get(sessionId)?.inFlight.get(id)
    if (!w) return false
    w.done(
      ok
        ? queued
          ? { ok: true, how: 'queued' }
          : { ok: true }
        : { ok: false, reason: error ? `Claude refused the message: ${error}` : 'Claude refused the message' },
    )
    return true
  }

  /** Queue a message for the session's mod and wait until Claude has taken it. */
  send(sessionId: string, text: string): Promise<Delivery> {
    const link = this.links.get(sessionId)
    if (!link || !this.connected(sessionId)) return Promise.resolve({ ok: false, reason: NOT_CONNECTED })
    return new Promise((resolve) => {
      const msg = { id: randomId(8), text }
      const w: Waiting = {
        msg,
        done: (d) => {
          clearTimeout(timer)
          link.queued = link.queued.filter((x) => x !== w)
          link.inFlight.delete(msg.id)
          resolve(d)
        },
      }
      const timer = setTimeout(
        () =>
          w.done({
            ok: false,
            reason: link.inFlight.has(msg.id)
              ? 'Claude got the message but did not confirm it. Check the session.'
              : 'Claude did not pick up the message. Is the session still open?',
          }),
        ACK_MS,
      )
      link.queued.push(w)
      link.poll?.(this.take(link))
    })
  }

  stop(): void {
    clearInterval(this.sweeper)
    for (const l of this.links.values()) {
      l.poll?.([])
      for (const w of [...l.queued, ...l.inFlight.values()]) w.done({ ok: false, reason: 'AgentWatch is restarting' })
    }
  }

  private take(l: Link): BridgeMessage[] {
    const out = l.queued.splice(0)
    for (const w of out) l.inFlight.set(w.msg.id, w)
    return out.map((w) => w.msg)
  }

  private report(sessionId: string, l: Link): void {
    const now = this.connected(sessionId)
    if (now === l.reported && l.queues === l.reportedQueues) return
    l.reported = now
    l.reportedQueues = l.queues
    this.o.onLink(sessionId, now)
  }

  private sweep(): void {
    for (const [id, l] of this.links) {
      this.report(id, l)
      const idle = !l.poll && !l.queued.length && !l.inFlight.size && this.now() - l.lastPoll > 60 * 60_000
      if (idle) this.links.delete(id)
    }
  }
}

export const NOT_CONNECTED =
  'Replies need the AgentWatch plugin running in this Claude session. Restart the session to load it.'
