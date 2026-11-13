// Codex adapter: an extra client of this OS user's Codex app-server daemon, the shared background server the Codex TUI
// talks to. It joins running threads, maps their status, turn and item events onto sessions, forwards approvals and
// questions as Requests (the first answer wins, the TUI's or the phone's), and sends phone replies: `turn/steer` into a
// running turn, `turn/start` otherwise.
// Protocol per spike S3 (codex-cli 0.166–0.167). Anything unexpected degrades to "status only", never to a crash, and
// requests this adapter doesn't understand are left for the TUI to answer.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  type CommandBody,
  clip,
  DETAIL_MAX,
  type Failure,
  type FailureKind,
  literal,
  projectFromCwd,
  type Question,
  type RequestInfo,
  readPrompt,
  type UsageWindow,
} from '@agentwatch/protocol'
import WebSocket from 'ws'
import type { AgentAdapter, Core, Delivery, HeldRequest } from '../daemon/core.ts'
import type { Logger } from '../log.ts'

export interface CodexAdapterOptions {
  log: Logger
  /** Our version, sent as clientInfo. */
  clientVersion: string
  /** How long an approval stays open on the phone. Codex itself waits indefinitely. */
  holdMs: number
  /** Defaults to $CODEX_HOME or ~/.codex. */
  codexHome?: string
  pollMs?: number
  /** Is a Codex TUI still running in this directory? null when it can't be told (no /proc). */
  tuiAlive?: (cwd: string) => boolean | null
  /** Called when what describe() says changes (e.g. the server's version became known). */
  onDescribe?: () => void
}

type Json = Record<string, unknown>

interface Thread {
  id: string
  joined: boolean
  tries: number
  nextTry: number
  cwd?: string
  lastMessage?: string
  turnPending: NodeJS.Timeout | null
  activeFallback: NodeJS.Timeout | null
  /** The running turn, from `turn/started`: a phone reply steers into it. */
  turnId?: string
  fileChanges: Map<string, { path: string; diff: string }[]>
  goneChecks: number
  /** Server requests that arrived while we were still joining (Codex replays pending approvals right after resume). */
  early: [number | string, string, Json][]
}

const MAX_RESUME_TRIES = 8
const LIVENESS_MS = 15_000

export class CodexAdapter implements AgentAdapter {
  readonly agent = 'codex' as const
  private ws: WebSocket | null = null
  private connected = false
  private stopped = false
  private serverVersion = ''
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; method: string }>()
  private threads = new Map<string, Thread>()
  /** Threads whose TUI went away; only joined again once a TUI runs in their directory. */
  private ended = new Map<string, string | undefined>()
  /** Codex server-request id → our Request. */
  private held = new Map<string, { request: HeldRequest; rpcId: number | string; threadId: string }>()
  private pollTimer: NodeJS.Timeout | null = null
  private liveTimer: NodeJS.Timeout | null = null
  private wake: (() => void) | null = null

  constructor(
    private core: Core,
    private o: CodexAdapterOptions,
  ) {}

  describe(): string {
    return this.serverVersion ? `codex ${this.serverVersion}` : 'codex'
  }

  start(): void {
    void this.loop()
    this.liveTimer = setInterval(() => this.checkLiveness(), LIVENESS_MS)
    this.liveTimer.unref()
  }

  stop(): void {
    this.stopped = true
    if (this.liveTimer) clearInterval(this.liveTimer)
    this.ws?.close()
    this.wake?.()
  }

  socketPath(): string {
    const home = this.o.codexHome ?? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex')
    return path.join(home, 'app-server-control', 'app-server-control.sock')
  }

  // ── Replies ──────────────────────────────────────────────────────────────────────────────────────────────────────

  async message(sessionId: string, text: string): Promise<Delivery> {
    const t = this.threads.get(sessionId)
    if (!this.connected || !t?.joined) return { ok: false, reason: 'AgentWatch is not connected to Codex right now' }
    const input = [{ type: 'text', text, text_elements: [] }]
    if (t.turnId) {
      try {
        await this.call('turn/steer', { threadId: sessionId, expectedTurnId: t.turnId, input })
        return { ok: true, how: 'steered' }
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        // The turn ended just now: start one instead. Review and compaction turns can't be steered.
        if (!/no active turn/i.test(why)) {
          return {
            ok: false,
            reason: /review|compact|steer/i.test(why)
              ? `Codex can't take a message during this turn: ${why}`
              : `Codex refused the message: ${why}`,
          }
        }
      }
    }
    try {
      await this.call('turn/start', { threadId: sessionId, input })
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: `Codex refused the message: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  private onRateLimits(raw: unknown): void {
    const windows = codexWindows(raw)
    if (windows.length) this.core.setUsage('codex', windows)
  }

  // ── Connection ───────────────────────────────────────────────────────────────────────────────────────────────────

  private async loop(): Promise<void> {
    let backoff = 1000
    while (!this.stopped) {
      const sock = this.socketPath()
      let real: string | null = null
      try {
        real = fs.realpathSync(sock)
      } catch {}
      if (real) {
        const started = Date.now()
        await this.session(real).catch((e) => this.o.log('warn', 'codex connection failed', { error: String(e) }))
        this.onDisconnect()
        if (Date.now() - started > 60_000) backoff = 1000
      }
      if (this.stopped) return
      // No daemon yet (Codex starts it on demand) or it went away (it auto-updates and restarts).
      await new Promise<void>((r) => {
        const t = setTimeout(r, real ? backoff : 30_000)
        t.unref()
        this.wake = () => {
          clearTimeout(t)
          r()
        }
      })
      backoff = Math.min(backoff * 2, 30_000)
    }
  }

  private session(socket: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws+unix:${socket}:/`)
      this.ws = ws
      ws.on('open', () => {
        void this.handshake().catch((e) => {
          this.o.log('warn', 'codex handshake failed; Codex sessions will not show', { error: String(e) })
          ws.close()
        })
      })
      ws.on('message', (buf) => {
        let msg: Json
        try {
          msg = JSON.parse(buf.toString()) as Json
        } catch {
          return
        }
        try {
          this.onMessage(msg)
        } catch (e) {
          this.o.log('warn', 'codex message not understood', { method: String(msg.method), error: String(e) })
        }
      })
      ws.on('close', () => resolve())
      ws.on('error', (e) => {
        if (ws.readyState !== WebSocket.OPEN) reject(e)
      })
    })
  }

  private async handshake(): Promise<void> {
    const init = (await this.call('initialize', {
      clientInfo: { name: 'agentwatch', title: 'AgentWatch', version: this.o.clientVersion },
      capabilities: { experimentalApi: true },
    })) as Json
    this.notify('initialized', {})
    this.connected = true
    const v = /\/(\d+\.\d+\.\d+)/.exec(String(init?.userAgent ?? ''))?.[1]
    if (v && v !== this.serverVersion) {
      this.serverVersion = v
      this.o.onDescribe?.()
    }
    this.o.log('info', 'codex connected', { version: v })
    // The account's rate limits now; `account/rateLimits/updated` keeps them fresh after each turn.
    this.call('account/rateLimits/read', {})
      .then((r) => this.onRateLimits((r as Json | null)?.rateLimits))
      .catch(() => {})
    this.pollTimer = setInterval(() => void this.poll(), this.o.pollMs ?? 2000)
    this.pollTimer.unref()
    void this.poll()
  }

  private onDisconnect(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
    const was = this.connected
    this.connected = false
    this.ws = null
    for (const p of this.pending.values()) p.reject(new Error('connection closed'))
    this.pending.clear()
    // Approvals pending on the old connection come back (with new ids) when we join the threads again.
    for (const h of this.held.values()) this.core.close(h.request.id, 'expired')
    this.held.clear()
    for (const t of this.threads.values()) {
      if (t.turnPending) clearTimeout(t.turnPending)
      if (t.activeFallback) clearTimeout(t.activeFallback)
      if (t.joined) this.core.setCaps(t.id, { reply: false, replyReason: 'AgentWatch lost its connection to Codex' })
    }
    this.threads.clear()
    if (was) this.o.log('info', 'codex disconnected')
  }

  private call(method: string, params: Json, timeoutMs = 15_000): Promise<unknown> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error('not connected'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, timeoutMs)
      timer.unref()
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  private notify(method: string, params: Json): void {
    this.ws?.send(JSON.stringify({ method, params }))
  }

  private respond(id: number | string, result: Json): void {
    this.ws?.send(JSON.stringify({ id, result }))
  }

  // ── Threads ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async poll(): Promise<void> {
    let ids: string[]
    try {
      const r = (await this.call('thread/loaded/list', {})) as { data?: unknown }
      ids = Array.isArray(r?.data) ? r.data.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return
    }
    const now = Date.now()
    for (const id of ids) {
      if (this.ended.has(id)) {
        const cwd = this.ended.get(id)
        if (!cwd || this.tuiAlive(cwd) !== true) continue
        this.ended.delete(id)
      }
      let t = this.threads.get(id)
      if (!t) {
        t = {
          id,
          joined: false,
          tries: 0,
          nextTry: 0,
          turnPending: null,
          activeFallback: null,
          fileChanges: new Map(),
          goneChecks: 0,
          early: [],
        }
        this.threads.set(id, t)
      }
      if (t.joined || t.tries >= MAX_RESUME_TRIES || t.nextTry > now) continue
      void this.join(t)
    }
  }

  private async join(t: Thread): Promise<void> {
    t.nextTry = Number.POSITIVE_INFINITY
    let r: { thread?: Json }
    try {
      r = (await this.call('thread/resume', { threadId: t.id, excludeTurns: true })) as { thread?: Json }
    } catch {
      // Usually "no rollout found": the thread has no first message yet. Ephemeral helper threads never get one.
      t.early = []
      t.tries++
      t.nextTry = Date.now() + 2000 * 2 ** Math.min(t.tries, 5)
      return
    }
    const th = r?.thread ?? {}
    if (th.ephemeral === true) {
      t.tries = MAX_RESUME_TRIES
      t.nextTry = 0
      t.early = []
      return
    }
    t.joined = true
    t.cwd = typeof th.cwd === 'string' ? th.cwd : undefined
    const name = typeof th.name === 'string' && th.name ? th.name : undefined
    const preview = typeof th.preview === 'string' && th.preview ? clip(th.preview, 120) : undefined
    this.core.ensure('codex', t.id)
    this.core.apply('codex', t.id, {
      type: 'session.start',
      at: Date.now(),
      info: {
        cwd: t.cwd,
        project: projectFromCwd(t.cwd),
        ...(typeof th.model === 'string' ? { model: th.model } : {}),
        ...(name || preview ? { title: name ?? preview } : {}),
      },
    })
    const status = th.status as Json | undefined
    if (status?.type === 'active') this.core.apply('codex', t.id, { type: 'turn.start', at: Date.now() })
    this.core.setCaps(t.id, { reply: true, busyReply: 'steer' })
    this.o.log('info', 'codex thread joined', { threadId: t.id })
    for (const [id, method, params] of t.early.splice(0)) this.onServerRequest(id, method, params)
  }

  private onMessage(msg: Json): void {
    const method = typeof msg.method === 'string' ? msg.method : undefined
    if (msg.id !== undefined && !method) {
      const p = this.pending.get(msg.id as number)
      if (!p) return
      this.pending.delete(msg.id as number)
      const err = msg.error as { message?: string } | undefined
      if (err) p.reject(new Error(err.message ?? JSON.stringify(err)))
      else p.resolve(msg.result)
      return
    }
    if (!method) return
    const params = (msg.params ?? {}) as Json
    if (msg.id !== undefined) this.onServerRequest(msg.id as number | string, method, params)
    else this.onNotification(method, params)
  }

  private thread(params: Json): Thread | undefined {
    const t = typeof params.threadId === 'string' ? this.threads.get(params.threadId) : undefined
    return t?.joined ? t : undefined
  }

  private onNotification(method: string, params: Json): void {
    if (method.endsWith('Delta') || method.endsWith('/delta')) return
    const t = this.thread(params)
    switch (method) {
      case 'turn/started': {
        if (!t) return
        const turn = (params.turn ?? {}) as Json
        if (typeof turn.id === 'string') t.turnId = turn.id
        // Wait a moment for the user message, so the timeline shows what was asked.
        if (t.turnPending) clearTimeout(t.turnPending)
        t.turnPending = setTimeout(() => this.startTurn(t), 400)
        return
      }
      case 'item/started': {
        if (!t) return
        const item = (params.item ?? {}) as Json
        if (item.type === 'userMessage' && t.turnPending) {
          const text = Array.isArray(item.content)
            ? (item.content as Json[])
                .filter((c) => c.type === 'text' && typeof c.text === 'string')
                .map((c) => c.text as string)
                .join('\n')
            : ''
          this.startTurn(t, text || undefined)
        }
        if (item.type === 'fileChange' && typeof item.id === 'string' && Array.isArray(item.changes)) {
          t.fileChanges.set(
            item.id,
            (item.changes as Json[])
              .map((c) => ({ path: String(c.path ?? ''), diff: typeof c.diff === 'string' ? c.diff : '' }))
              .filter((c) => c.path),
          )
        }
        return
      }
      case 'item/completed': {
        if (!t) return
        const item = (params.item ?? {}) as Json
        if (item.type === 'agentMessage' && typeof item.text === 'string' && item.text)
          if (item.phase === 'final_answer' || !t.lastMessage) t.lastMessage = item.text
        return
      }
      case 'turn/completed': {
        if (!t) return
        t.turnId = undefined
        const turn = (params.turn ?? {}) as Json
        this.endTurn(t, turn.status === 'failed' ? codexFailure(turn.error) : undefined)
        return
      }
      case 'thread/status/changed': {
        if (!t) return
        const status = (params.status ?? {}) as Json
        const s = this.core.sessions.get(t.id)
        if (status.type === 'active' && s && (s.state === 'idle' || s.state === 'unknown')) {
          // turn/started normally follows at once and carries the prompt; this only covers a missed one.
          if (!t.activeFallback && !t.turnPending)
            t.activeFallback = setTimeout(() => {
              t.activeFallback = null
              const cur = this.core.sessions.get(t.id)
              if (t.joined && !t.turnPending && (cur?.state === 'idle' || cur?.state === 'unknown'))
                this.core.apply('codex', t.id, { type: 'turn.start', at: Date.now() })
            }, 1500)
        } else if (status.type === 'idle' && s && (s.state === 'working' || s.state === 'needs_you')) {
          t.turnId = undefined
          this.endTurn(t)
        } else if (status.type === 'notLoaded') this.endThread(t)
        return
      }
      case 'account/rateLimits/updated':
        this.onRateLimits(params.rateLimits)
        return
      case 'thread/tokenUsage/updated': {
        if (!t) return
        const usage = (params.tokenUsage ?? {}) as Json
        const last = (usage.last ?? {}) as Json
        const window = usage.modelContextWindow
        if (typeof last.totalTokens === 'number' && typeof window === 'number' && window > 0)
          this.core.setSessionUsage(t.id, { contextPercent: Math.min(100, (100 * last.totalTokens) / window) })
        return
      }
      case 'thread/closed': {
        if (t) this.endThread(t)
        return
      }
      case 'thread/name/updated': {
        if (!t || typeof params.threadName !== 'string') return
        const s = this.core.sessions.get(t.id)
        if (s)
          this.core.apply('codex', t.id, {
            type: 'info',
            at: Date.now(),
            info: { ...s.info, title: params.threadName },
          })
        return
      }
      case 'serverRequest/resolved': {
        const h = this.held.get(String(params.requestId))
        if (h) {
          this.held.delete(String(params.requestId))
          this.core.close(h.request.id, 'answered_locally')
        }
        return
      }
    }
  }

  private startTurn(t: Thread, prompt?: string): void {
    if (t.turnPending) clearTimeout(t.turnPending)
    t.turnPending = null
    t.lastMessage = undefined
    // Same rule as Claude: harness-made input (instruction envelopes and the like) never shows as your message.
    const read = prompt ? readPrompt(prompt) : null
    const text = read?.from === 'you' ? read.text : read ? prompt : undefined
    this.core.apply('codex', t.id, { type: 'turn.start', at: Date.now() }, text !== undefined ? { text } : {})
  }

  private endTurn(t: Thread, failure?: Failure): void {
    if (t.turnPending) this.startTurn(t)
    for (const [k, h] of this.held) {
      if (h.threadId !== t.id) continue
      this.held.delete(k)
      this.core.close(h.request.id, 'answered_locally')
    }
    const message = t.lastMessage
    this.core.apply('codex', t.id, {
      type: 'turn.end',
      at: Date.now(),
      ...(message ? { message } : {}),
      ...(failure ? { failure } : {}),
    })
    t.fileChanges.clear()
  }

  private endThread(t: Thread): void {
    for (const [k, h] of this.held) {
      if (h.threadId !== t.id) continue
      this.held.delete(k)
      this.core.close(h.request.id, 'cancelled')
    }
    if (t.turnPending) clearTimeout(t.turnPending)
    if (t.activeFallback) clearTimeout(t.activeFallback)
    this.threads.delete(t.id)
    this.ended.set(t.id, t.cwd)
    this.core.apply('codex', t.id, { type: 'session.end', at: Date.now() })
    this.call('thread/unsubscribe', { threadId: t.id }).catch(() => {})
  }

  // ── Approvals and questions ──────────────────────────────────────────────────────────────────────────────────────

  private onServerRequest(rpcId: number | string, method: string, params: Json): void {
    const t = this.thread(params)
    if (!t) {
      const joining = typeof params.threadId === 'string' ? this.threads.get(params.threadId) : undefined
      if (joining && joining.nextTry === Number.POSITIVE_INFINITY) joining.early.push([rpcId, method, params])
      return
    }
    let kind: 'permission' | 'question' = 'permission'
    let info: RequestInfo
    let answerable: boolean | undefined
    let reply: (body: CommandBody) => Json | null
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const cmd = literal(unwrapShell(typeof params.command === 'string' ? params.command : ''), DETAIL_MAX)
        const reason = typeof params.reason === 'string' ? params.reason : ''
        info = {
          title: 'Run a command',
          tool: 'shell',
          detail: [cmd.text, reason && `# ${clip(reason, 300)}`].filter(Boolean).join('\n'),
        }
        if (cmd.cut) answerable = false
        reply = (b) => (b.kind === 'decide' ? { decision: b.behavior === 'allow' ? 'accept' : 'decline' } : null)
        break
      }
      case 'item/fileChange/requestApproval': {
        const files = t.fileChanges.get(String(params.itemId)) ?? []
        const reason = typeof params.reason === 'string' ? params.reason : ''
        // The file names and the diffs: what will change, not just where.
        const shown = literal(
          files.map((f) => [relativeTo(f.path, t.cwd), f.diff.trimEnd()].filter(Boolean).join('\n')).join('\n\n'),
          DETAIL_MAX,
        )
        info = {
          title: files.length === 1 ? 'Edit a file' : 'Edit files',
          tool: 'apply_patch',
          detail: [shown.text || 'Apply changes', reason && `# ${clip(reason, 300)}`].filter(Boolean).join('\n'),
        }
        // Approve from the phone only what the phone can show in full.
        if (shown.cut || !files.length || files.some((f) => !f.diff)) answerable = false
        reply = (b) => (b.kind === 'decide' ? { decision: b.behavior === 'allow' ? 'accept' : 'decline' } : null)
        break
      }
      case 'item/tool/requestUserInput': {
        const raw = Array.isArray(params.questions) ? (params.questions as Json[]) : []
        const questions: Question[] = raw.map((q) => ({
          question: String(q.question ?? ''),
          ...(typeof q.header === 'string' ? { header: q.header } : {}),
          options: Array.isArray(q.options)
            ? (q.options as Json[]).map((o) => ({
                label: String(o.label ?? ''),
                ...(typeof o.description === 'string' ? { description: o.description } : {}),
              }))
            : [],
          multiSelect: false,
        }))
        kind = 'question'
        info = { title: questions.length > 1 ? `${questions.length} questions` : 'Question', questions }
        // Free-text and secret questions are answered at the computer.
        if (raw.some((q) => !Array.isArray(q.options) || !(q.options as unknown[]).length || q.isSecret === true))
          answerable = false
        reply = (b) => {
          if (b.kind !== 'answer') return null
          const answers: Record<string, { answers: string[] }> = {}
          for (const q of raw) {
            const a = b.answers[String(q.question ?? '')]
            if (a !== undefined) answers[String(q.id)] = { answers: [a] }
          }
          return { answers }
        }
        break
      }
      case 'item/permissions/requestApproval': {
        const reason = typeof params.reason === 'string' ? params.reason : ''
        info = { title: 'Grant permissions', detail: reason || 'Codex asks for more permissions.' }
        answerable = false
        reply = () => null
        break
      }
      default:
        // Not ours (auth refresh, tool calls, elicitations…): the TUI answers these.
        return
    }
    const request = this.core.openRequest({
      agent: 'codex',
      sessionId: t.id,
      kind,
      info,
      ...(answerable === false ? { answerable } : {}),
      timeoutMs: this.o.holdMs,
    })
    const key = String(rpcId)
    const ws = this.ws
    this.held.set(key, { request, rpcId, threadId: t.id })
    void request.done.then((outcome) => {
      this.held.delete(key)
      if (outcome.type !== 'command' || this.ws !== ws) return
      const result = reply(outcome.body)
      if (result) this.respond(rpcId, result)
    })
  }

  // ── Liveness ─────────────────────────────────────────────────────────────────────────────────────────────────────

  private tuiAlive(cwd: string): boolean | null {
    return (this.o.tuiAlive ?? codexTuiAlive)(cwd)
  }

  /** The app-server keeps a thread loaded while we're subscribed, so "ended" means: no Codex TUI left in its folder. */
  private checkLiveness(): void {
    for (const t of [...this.threads.values()]) {
      if (!t.joined || !t.cwd) continue
      const alive = this.tuiAlive(t.cwd)
      if (alive !== false) {
        t.goneChecks = 0
        continue
      }
      if (++t.goneChecks >= 2) this.endThread(t)
    }
  }
}

/** `/bin/bash -lc 'printf hi > hello.txt'` → `printf hi > hello.txt` */
export function unwrapShell(cmd: string): string {
  const m = /^(?:\/(?:usr\/)?bin\/)?(?:ba|z)?sh\s+-l?c\s+(['"])([\s\S]*)\1$/.exec(cmd.trim())
  if (!m) return cmd
  return m[1] === "'" ? m[2]!.replace(/'\\''/g, "'") : m[2]!
}

function relativeTo(file: string, cwd?: string): string {
  return cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file
}

/** Linux: is a Codex TUI (not the app-server itself) running with this working directory? */
export function codexTuiAlive(cwd: string, procDir = '/proc'): boolean | null {
  let pids: string[]
  try {
    pids = fs.readdirSync(procDir).filter((p) => /^\d+$/.test(p))
  } catch {
    return null
  }
  for (const pid of pids) {
    try {
      if (fs.readlinkSync(path.join(procDir, pid, 'cwd')) !== cwd) continue
      const argv = fs
        .readFileSync(path.join(procDir, pid, 'cmdline'), 'utf8')
        .split('\0')
        .filter(Boolean)
      const isCodex = argv.slice(0, 2).some((a) => /(^|\/)codex(\.js)?$/.test(a))
      if (isCodex && !argv.includes('app-server')) return true
    } catch {}
  }
  return false
}

/**
 * `account/rateLimits/*`'s `rateLimits`: `primary` and `secondary` windows of `{usedPercent, windowDurationMins,
 * resetsAt}`, with `resetsAt` in Unix seconds (Claude's is ISO).
 */
export function codexWindows(raw: unknown): UsageWindow[] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Json
  const out: UsageWindow[] = []
  for (const [slot, w] of [
    ['primary', r.primary],
    ['secondary', r.secondary],
  ] as const) {
    if (!w || typeof w !== 'object') continue
    const { usedPercent, windowDurationMins: mins, resetsAt } = w as Json
    if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent)) continue
    const minutes = typeof mins === 'number' && mins > 0 ? Math.round(mins) : undefined
    out.push({
      kind: minutes === 300 ? 'five_hour' : minutes === 10_080 ? 'seven_day' : 'other',
      ...(minutes && minutes !== 300 && minutes !== 10_080 ? { minutes } : {}),
      ...(minutes ? {} : { name: slot }),
      percent: Math.min(100, Math.max(0, usedPercent)),
      resetsAt: typeof resetsAt === 'number' && resetsAt > 0 ? resetsAt * 1000 : null,
    })
  }
  return out
}

const CODEX_FAILURE: Record<string, FailureKind> = {
  usageLimitExceeded: 'usage_limit',
  rateLimitExceeded: 'usage_limit',
  sessionBudgetExceeded: 'usage_limit',
  serverOverloaded: 'overloaded',
  internalServerError: 'overloaded',
  policyCapacityUnavailable: 'overloaded',
  flexUnavailable: 'overloaded',
  httpConnectionFailed: 'overloaded',
  responseStreamConnectionFailed: 'overloaded',
  responseStreamDisconnected: 'overloaded',
  responseTooManyFailedAttempts: 'overloaded',
  unauthorized: 'auth',
  contextWindowExceeded: 'context_full',
}

/** A failed turn's `turn.error` (`{message, codexErrorInfo, additionalDetails}`), as the failure every agent shares. */
export function codexFailure(raw: unknown): Failure {
  const e = (raw && typeof raw === 'object' ? raw : {}) as Json
  const info = e.codexErrorInfo
  // Plain variants are strings; ones with data are a one-key object (`{ httpConnectionFailed: {…} }`).
  const code = typeof info === 'string' ? info : info && typeof info === 'object' ? (Object.keys(info)[0] ?? '') : ''
  const detail = [e.message, e.additionalDetails].filter((x) => typeof x === 'string' && x).join(' ')
  return { kind: CODEX_FAILURE[code] ?? 'error', ...(detail ? { detail: clip(detail, 500) } : {}) }
}
