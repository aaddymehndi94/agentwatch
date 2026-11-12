// The daemon's model of this OS user's agents. Adapters feed it AgentEvents and open Requests; it folds them through the
// protocol state machine, seals what leaves the machine (filtered by privacy), applies the notify policy, and turns
// verified phone Commands back into adapter actions. Everything sent to the relay goes through one ordered queue.

import {
  type AgentEvent,
  type AgentKind,
  bind,
  type Capabilities,
  type CommandBody,
  type CommandEnvelope,
  type CommandStatus,
  clip,
  decide,
  type EventKind,
  newSession,
  type Privacy,
  type RequestInfo,
  type RequestKind,
  type RequestStatus,
  type RequestWire,
  randomId,
  reduce,
  type Session,
  type SessionInfo,
  type SessionWire,
  type SourceMessage,
  seal,
  type Transition,
  verifyCommand,
} from '@agentwatch/protocol'
import type { Logger } from '../log.ts'

/** How a held request ends, as seen by whoever opened it. */
export type Outcome =
  | { type: 'command'; body: Extract<CommandBody, { kind: 'decide' | 'answer' }> }
  | { type: 'closed'; status: RequestStatus }

export interface AgentAdapter {
  readonly agent: AgentKind
  /** Version string reported in hello, e.g. "claude 2.1.322" or "codex 0.166.0 (status-only)". */
  describe(): string
  /** Deliver a free-text message to an idle session. */
  message?(sessionId: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }>
  stop?(): void
}

export interface OpenRequestArgs {
  agent: AgentKind
  sessionId: string
  kind: RequestKind
  info: RequestInfo
  /** False when the phone can only look (e.g. a question under summary privacy is decided by core). */
  answerable?: boolean
  /** Close as `expired` after this long (0 = never). */
  timeoutMs: number
  /** Adapter-defined key used to recognise a local resolution (e.g. tool name + input). */
  match?: string
}

export interface HeldRequest {
  id: string
  sessionId: string
  kind: RequestKind
  createdAt: number
  status: RequestStatus
  closedAt: number | null
  info: RequestInfo
  answerable: boolean
  match?: string
  done: Promise<Outcome>
  settle: (o: Outcome) => void
  timer?: NodeJS.Timeout
}

export interface CoreOptions {
  sourceId: string
  key: CryptoKey
  privacy: Privacy
  allowMessages: boolean
  doneMinSeconds: number
  /** Wait this long before pushing needs_you, so prompts answered at the keyboard don't buzz the phone. */
  needsYouDelayMs: number
  send: (msg: SourceMessage) => void
  log: Logger
  startedAt: number
  now?: () => number
  /** Called (often) after sessions change, so the daemon can persist them across restarts. */
  onChange?: () => void
}

const ENDED_KEEP_MS = 60 * 60_000
const CLOSED_KEEP_MS = 10 * 60_000
const NONCE_KEEP_MS = 15 * 60_000

export class Core {
  readonly sessions = new Map<string, Session>()
  readonly requests = new Map<string, HeldRequest>()
  readonly adapters = new Map<AgentKind, AgentAdapter>()
  private nonces = new Map<string, number>()
  private pushTimers = new Map<string, NodeJS.Timeout>()
  private chain: Promise<void> = Promise.resolve()
  private pruneTimer: NodeJS.Timeout

  constructor(private o: CoreOptions) {
    this.pruneTimer = setInterval(() => this.prune(), 60_000)
    this.pruneTimer.unref()
  }

  /** The vault key was rotated: seal and verify with the new one from now on. */
  setKey(key: CryptoKey): void {
    this.o.key = key
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  get privacy(): Privacy {
    return this.o.privacy
  }

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.agent, adapter)
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Get a session, creating it (state `unknown`) the first time an adapter mentions it. */
  ensure(agent: AgentKind, id: string, info?: SessionInfo): Session {
    let s = this.sessions.get(id)
    if (!s) {
      s = newSession(id, agent, this.now())
      if (info) s = reduce(s, { type: 'info', at: this.now(), info }).session
      this.sessions.set(id, s)
    }
    return s
  }

  /** Fold an event into a session, publish the new state and act on the transition. */
  apply(agent: AgentKind, id: string, event: AgentEvent, opts: { text?: string } = {}): Transition | null {
    const before = this.ensure(agent, id)
    const { session, transition } = reduce(before, event)
    this.sessions.set(id, session)
    if (session !== before) this.publishSession(session)
    if (transition) this.onTransition(session, transition, opts.text)
    return transition
  }

  setCaps(id: string, caps: Capabilities): void {
    const s = this.sessions.get(id)
    if (!s || (s.caps.reply === caps.reply && s.caps.replyReason === caps.replyReason)) return
    const next = { ...s, caps, updatedAt: this.now() }
    this.sessions.set(id, next)
    this.publishSession(next)
  }

  /** Open requests of a session, oldest first. */
  openRequestsOf(sessionId: string): HeldRequest[] {
    return [...this.requests.values()].filter((r) => r.sessionId === sessionId && r.status === 'open')
  }

  // ── Requests ─────────────────────────────────────────────────────────────────────────────────────────────────────

  openRequest(a: OpenRequestArgs): HeldRequest {
    const id = randomId(12)
    let settle!: (o: Outcome) => void
    const done = new Promise<Outcome>((resolve) => {
      settle = resolve
    })
    const answerable = a.answerable ?? (a.kind === 'permission' || this.o.privacy === 'full')
    const req: HeldRequest = {
      id,
      sessionId: a.sessionId,
      kind: a.kind,
      createdAt: this.now(),
      status: 'open',
      closedAt: null,
      info: a.info,
      answerable,
      match: a.match,
      done,
      settle,
    }
    if (a.timeoutMs > 0) {
      req.timer = setTimeout(() => this.close(id, 'expired'), a.timeoutMs)
      req.timer.unref()
    }
    this.requests.set(id, req)
    this.publishRequest(req)
    this.apply(a.agent, a.sessionId, { type: 'request.open', at: req.createdAt, requestId: id })
    return req
  }

  /** Close a request without a phone answer (answered locally, expired, cancelled). Idempotent. */
  close(requestId: string, status: Exclude<RequestStatus, 'open'>): void {
    const req = this.requests.get(requestId)
    if (req?.status !== 'open') return
    this.finish(req, status)
    req.settle({ type: 'closed', status })
  }

  private finish(req: HeldRequest, status: Exclude<RequestStatus, 'open'>, how?: string): void {
    req.status = status
    req.closedAt = this.now()
    if (req.timer) clearTimeout(req.timer)
    const pt = this.pushTimers.get(req.id)
    if (pt) {
      clearTimeout(pt)
      this.pushTimers.delete(req.id)
    }
    const at = req.closedAt
    this.enqueue(async () => ({ t: 'request.close', requestId: req.id, status, at }))
    const s = this.sessions.get(req.sessionId)
    if (s) {
      this.apply(
        s.agent,
        s.id,
        { type: 'request.close', at, requestId: req.id },
        { text: how ?? describeClose(status) },
      )
    }
  }

  // ── Commands from the phone ──────────────────────────────────────────────────────────────────────────────────────

  /** Verify and apply a phone command. Resolves once its ack has been handed to the relay link. */
  async handleCommand(env: CommandEnvelope): Promise<void> {
    await this.applyCommand(env)
    await this.flushed()
  }

  private async applyCommand(env: CommandEnvelope): Promise<void> {
    const v = await verifyCommand(this.o.key, env, {
      sourceId: this.o.sourceId,
      notBefore: this.o.startedAt,
      now: this.now(),
      seenNonce: (n) => this.seenNonce(n),
    })
    if (!v.ok) {
      this.o.log('warn', 'rejected command', { commandId: env.commandId, reason: v.reason })
      return this.ack(env.commandId, 'rejected', v.reason)
    }
    const body = v.body
    if (body.kind === 'message') return this.deliverMessage(env, body.text)
    const req = env.requestId ? this.requests.get(env.requestId) : undefined
    if (!req || req.sessionId !== env.sessionId) return this.ack(env.commandId, 'rejected', 'Request not found')
    if (req.status !== 'open') return this.ack(env.commandId, 'rejected', alreadyClosed(req.status))
    if (!req.answerable) return this.ack(env.commandId, 'rejected', 'This request can only be answered at the computer')
    if (body.kind === 'answer' && req.kind !== 'question') return this.ack(env.commandId, 'rejected', 'Not a question')
    const how =
      body.kind === 'answer'
        ? 'Answered from phone'
        : body.behavior === 'allow'
          ? 'Approved from phone'
          : 'Denied from phone'
    this.finish(req, 'answered', how)
    req.settle({ type: 'command', body })
    this.o.log('info', 'request answered from phone', { requestId: req.id, kind: body.kind })
    this.ack(env.commandId, 'applied')
  }

  private async deliverMessage(env: CommandEnvelope, text: string): Promise<void> {
    if (!this.o.allowMessages) return this.ack(env.commandId, 'rejected', 'Messages are turned off for this machine')
    const s = this.sessions.get(env.sessionId)
    if (!s || s.state === 'ended') return this.ack(env.commandId, 'rejected', 'Session has ended')
    if (s.state !== 'idle') return this.ack(env.commandId, 'rejected', 'The agent is busy; try again when it is idle')
    const adapter = this.adapters.get(s.agent)
    if (!adapter?.message) return this.ack(env.commandId, 'rejected', 'This agent cannot take messages')
    const r = await adapter.message(s.id, text)
    if (!r.ok) return this.ack(env.commandId, 'rejected', r.reason)
    this.publishEvent(s.id, 'replied', text)
    this.ack(env.commandId, 'applied')
  }

  private ack(commandId: string, status: CommandStatus, detail?: string): void {
    this.enqueue(async () => ({
      t: 'command.ack',
      commandId,
      status,
      ...(detail ? { detail: clip(detail, 300) } : {}),
    }))
  }

  private seenNonce(n: string): boolean {
    if (this.nonces.has(n)) return true
    this.nonces.set(n, this.now())
    return false
  }

  // ── Publishing ───────────────────────────────────────────────────────────────────────────────────────────────────

  /** Serialise sends so the relay sees state changes in order, even though sealing is async. */
  private enqueue(build: () => Promise<SourceMessage | null>): void {
    this.chain = this.chain
      .then(build)
      .then((msg) => {
        if (msg) this.o.send(msg)
      })
      .catch((e) => this.o.log('error', 'failed to publish', { error: String(e) }))
  }

  private publishSession(s: Session): void {
    this.o.onChange?.()
    this.enqueue(async () => ({ t: 'session', session: await this.sessionWire(s) }))
  }

  private publishRequest(r: HeldRequest): void {
    this.enqueue(async () => ({ t: 'request.open', request: await this.requestWire(r) }))
  }

  private publishEvent(sessionId: string, kind: EventKind, text?: string): void {
    const at = this.now()
    const clear = this.o.privacy === 'full' && text ? text : undefined
    this.enqueue(async () => ({
      t: 'event',
      event: {
        sessionId,
        at,
        kind,
        ...(clear
          ? {
              sealed: await seal(
                this.o.key,
                { text: clip(clear, 2000) },
                bind.event(this.o.sourceId, { sessionId, at, kind }),
              ),
            }
          : {}),
      },
    }))
  }

  private onTransition(s: Session, t: Transition, text?: string): void {
    const req = t.kind === 'needs_you' ? this.requests.get(t.requestId) : undefined
    const eventText =
      t.kind === 'done' ? s.info.snippet : t.kind === 'needs_you' && req ? (req.info.detail ?? req.info.title) : text
    // `started` is implied by the session appearing; every other transition is a timeline event.
    if (t.kind !== 'started') this.publishEvent(s.id, t.kind, eventText)
    const intent = decide(s, t, { privacy: this.o.privacy, doneMinSeconds: this.o.doneMinSeconds, request: req?.info })
    if (!intent) return
    const sendPush = () => {
      this.pushTimers.delete(intent.requestId ?? '')
      if (intent.requestId && this.requests.get(intent.requestId)?.status !== 'open') return
      const tag = intent.tag
      this.enqueue(async () => ({
        t: 'push',
        push: {
          tag,
          kind: intent.kind,
          urgency: intent.urgency,
          sessionId: s.id,
          ...(intent.requestId ? { requestId: intent.requestId } : {}),
          actions: intent.actions && !!req?.answerable,
          sealed: await seal(this.o.key, intent.info, bind.push(this.o.sourceId, tag)),
        },
      }))
    }
    if (intent.kind === 'needs_you' && intent.requestId && this.o.needsYouDelayMs > 0) {
      const timer = setTimeout(sendPush, this.o.needsYouDelayMs)
      timer.unref()
      this.pushTimers.set(intent.requestId, timer)
    } else {
      sendPush()
    }
  }

  // ── Wire shapes ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** What of a session's info may leave the machine. `summary` keeps only the folder name and model. */
  private visibleInfo(info: SessionInfo): SessionInfo {
    if (this.o.privacy === 'summary') return { project: info.project, model: info.model }
    return {
      title: info.title ? clip(info.title, 300) : undefined,
      project: info.project,
      cwd: info.cwd,
      snippet: info.snippet ? clip(info.snippet, 2000) : undefined,
      model: info.model,
    }
  }

  private visibleRequest(info: RequestInfo, kind: RequestKind): RequestInfo {
    if (this.o.privacy === 'full') return info
    return {
      title: kind === 'question' ? 'Question' : info.tool ? `Use ${info.tool}` : 'Permission',
      tool: info.tool,
    }
  }

  private caps(s: Session): Capabilities {
    if (!this.o.allowMessages) return { reply: false, replyReason: 'Messages are turned off for this machine' }
    if (s.state === 'ended') return { reply: false, replyReason: 'Session has ended' }
    if (!s.caps.reply) return s.caps
    if (s.state !== 'idle') return { reply: false, replyReason: 'You can reply when the agent is idle' }
    return { reply: true }
  }

  private async sessionWire(s: Session): Promise<SessionWire> {
    return {
      id: s.id,
      agent: s.agent,
      state: s.state,
      stateSince: s.stateSince,
      startedAt: s.startedAt,
      turnStartedAt: s.turnStartedAt,
      updatedAt: s.updatedAt,
      caps: this.caps(s),
      sealed: await seal(this.o.key, this.visibleInfo(s.info), bind.session(this.o.sourceId, s.id)),
    }
  }

  private async requestWire(r: HeldRequest): Promise<RequestWire> {
    return {
      id: r.id,
      sessionId: r.sessionId,
      kind: r.kind,
      createdAt: r.createdAt,
      status: r.status,
      closedAt: r.closedAt,
      answerable: r.answerable,
      sealed: await seal(
        this.o.key,
        this.visibleRequest(r.info, r.kind),
        bind.request(this.o.sourceId, r.sessionId, r.id),
      ),
    }
  }

  /** Full state, sent after every (re)connect. Goes through the queue so it is never older than what was sent. */
  snapshot(): Promise<SourceMessage> {
    return new Promise((resolve, reject) => {
      this.enqueue(async () => {
        try {
          const sessions = await Promise.all([...this.sessions.values()].map((s) => this.sessionWire(s)))
          const requests = await Promise.all(
            [...this.requests.values()].filter((r) => r.status === 'open').map((r) => this.requestWire(r)),
          )
          resolve({ t: 'snapshot', sessions, requests })
        } catch (e) {
          reject(e)
        }
        return null
      })
    })
  }

  /** A test notification to every paired phone, sealed like any other push. */
  async testPush(where: string): Promise<Extract<SourceMessage, { t: 'push' }>> {
    const tag = 'test'
    const info = { title: 'AgentWatch test', body: `Notifications work. Sent from ${where}.` }
    return {
      t: 'push',
      push: {
        tag,
        kind: 'test',
        urgency: 'normal',
        actions: false,
        sealed: await seal(this.o.key, info, bind.push(this.o.sourceId, tag)),
      },
    }
  }

  /** Sessions worth remembering across a daemon restart. */
  exportSessions(): Session[] {
    const now = this.now()
    return [...this.sessions.values()].filter((s) => s.state !== 'ended' || now - s.stateSince < ENDED_KEEP_MS)
  }

  /**
   * Restore sessions saved by a previous daemon. Their held hooks died with it, so open requests are dropped (Claude
   * falls back to its terminal dialog); everything else is re-sent with the first snapshot.
   */
  restoreSessions(list: Session[], maxAgeMs = 3 * 24 * 3600_000): void {
    const now = this.now()
    for (const s of list) {
      if (this.sessions.has(s.id) || now - s.updatedAt > maxAgeMs) continue
      const state = s.state === 'needs_you' ? (s.turnStartedAt !== null ? 'working' : 'idle') : s.state
      // Adapters re-assert what a session can do once they hear from it again.
      this.sessions.set(s.id, {
        ...s,
        state,
        openRequests: [],
        caps: { reply: false, replyReason: 'Not connected yet' },
      })
    }
  }

  // ── Housekeeping ─────────────────────────────────────────────────────────────────────────────────────────────────

  private prune(): void {
    const now = this.now()
    for (const [id, s] of this.sessions)
      if (s.state === 'ended' && now - s.stateSince > ENDED_KEEP_MS) this.sessions.delete(id)
    for (const [id, r] of this.requests)
      if (r.status !== 'open' && r.closedAt && now - r.closedAt > CLOSED_KEEP_MS) this.requests.delete(id)
    for (const [n, at] of this.nonces) if (now - at > NONCE_KEEP_MS) this.nonces.delete(n)
  }

  /** Release every held request (daemon shutting down). Hooks then fall back to the terminal dialog. */
  stop(): void {
    clearInterval(this.pruneTimer)
    for (const t of this.pushTimers.values()) clearTimeout(t)
    for (const r of this.requests.values()) if (r.status === 'open') this.close(r.id, 'cancelled')
    for (const a of this.adapters.values()) a.stop?.()
  }

  /** Resolves once everything queued so far has been handed to the relay link. */
  flushed(): Promise<void> {
    return this.chain
  }
}

function describeClose(status: RequestStatus): string {
  switch (status) {
    case 'answered_locally':
      return 'Answered at the computer'
    case 'expired':
      return 'Timed out'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Answered'
  }
}

function alreadyClosed(status: RequestStatus): string {
  switch (status) {
    case 'answered':
      return 'Already answered from another device'
    case 'answered_locally':
      return 'Already answered at the computer'
    case 'expired':
      return 'This request timed out'
    default:
      return 'This request is no longer open'
  }
}
