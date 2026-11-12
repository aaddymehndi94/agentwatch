// Generic adapter: any script or homemade agent can show up on the phone without a plugin.
// - `agentwatch emit` reports a session's state (working / idle / ended) and a status line.
// - `agentwatch ask` opens a question (or a yes/no approval) and waits for the phone's answer.
// Session ids are the caller's own names, kept apart from Claude's and Codex's ids with a `g:` prefix.

import { clip, projectFromCwd, randomId, type SessionInfo, type SessionState } from '@agentwatch/protocol'
import { z } from 'zod'
import type { AgentAdapter, Core } from '../daemon/core.ts'
import type { Logger } from '../log.ts'
import { VERSION } from '../version.ts'

const SessionName = z.string().regex(/^[\w.:@-]{1,100}$/, 'Use letters, digits and . : @ _ - (up to 100)')

export const EmitArgs = z.object({
  session: SessionName,
  state: z.enum(['working', 'idle', 'ended']).optional(),
  title: z.string().max(300).optional(),
  project: z.string().max(200).optional(),
  cwd: z.string().max(1000).optional(),
  message: z.string().max(8000).optional(),
  /** End the session when this process exits. */
  pid: z.number().int().positive().optional(),
})
export type EmitArgs = z.infer<typeof EmitArgs>

export const AskArgs = z.object({
  question: z.string().min(1).max(2000),
  /** Defaults to Yes / No. */
  choices: z.array(z.string().min(1).max(200)).min(1).max(20).optional(),
  multi: z.boolean().default(false),
  /** An approval instead of a question: Approve / Deny, with one-tap actions on Android notifications. */
  approve: z.boolean().default(false),
  detail: z.string().max(4000).optional(),
  /** Ask inside a session reported with `emit`; otherwise the question gets a session of its own. */
  session: SessionName.optional(),
  title: z.string().max(300).optional(),
  cwd: z.string().max(1000).optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(24 * 3600_000),
})
export type AskArgs = z.infer<typeof AskArgs>

export type AskResult =
  | { status: 'answered'; answers: string[] }
  | { status: 'approved' }
  | { status: 'denied'; message?: string }
  | { status: 'expired' | 'cancelled' | 'answered_locally' }

export class AskRefused extends Error {}

const NO_REPLIES = { reply: false, replyReason: 'This agent can’t take replies' }
/** A reported session that hears nothing for this long is ended, so forgotten scripts don't pile up. */
const STALE_MS = 24 * 3600_000
const SWEEP_MS = 15_000

export interface GenericOptions {
  log: Logger
  now?: () => number
  pidAlive?: (pid: number) => boolean
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Which of `choices` an answer names. The app joins several with ", ", and a label may itself contain ", ", so
 * read it left to right, longest label first. */
export function pickedChoices(answer: string, choices: string[]): string[] {
  const byLength = [...choices].sort((a, b) => b.length - a.length)
  const out: string[] = []
  let at = 0
  while (at < answer.length) {
    const c = byLength.find(
      (l) => answer.startsWith(l, at) && (at + l.length === answer.length || answer.startsWith(', ', at + l.length)),
    )
    if (!c) break
    if (!out.includes(c)) out.push(c)
    at += c.length + 2
  }
  return out
}

export class GenericAdapter implements AgentAdapter {
  readonly agent = 'generic' as const
  private pids = new Map<string, number>()
  private sweeper: NodeJS.Timeout

  constructor(
    private core: Core,
    private o: GenericOptions,
  ) {
    // Sessions restored from before a restart: they still can't take replies.
    for (const s of core.sessions.values()) if (s.agent === 'generic') core.setCaps(s.id, NO_REPLIES)
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS)
    this.sweeper.unref()
  }

  describe(): string {
    return `generic ${VERSION}`
  }

  stop(): void {
    clearInterval(this.sweeper)
  }

  private now(): number {
    return this.o.now?.() ?? Date.now()
  }

  /** Start the session if it isn't live yet, and merge in what we know about it. */
  private touch(id: string, info: SessionInfo): void {
    const at = this.now()
    const s = this.core.sessions.get(id)
    if (!s || s.state === 'ended' || s.state === 'unknown')
      this.core.apply('generic', id, { type: 'session.start', at, info })
    else if (Object.values(info).some((v) => v !== undefined))
      this.core.apply('generic', id, { type: 'info', at, info })
    this.core.setCaps(id, NO_REPLIES)
  }

  private info(a: { title?: string; project?: string; cwd?: string }): SessionInfo {
    return {
      ...(a.title ? { title: clip(a.title, 300) } : {}),
      ...(a.cwd ? { cwd: a.cwd } : {}),
      ...(a.project || a.cwd ? { project: a.project ?? projectFromCwd(a.cwd) } : {}),
    }
  }

  emit(a: EmitArgs): { session: string; state: SessionState } {
    const id = `g:${a.session}`
    const at = this.now()
    this.touch(id, this.info(a))
    if (a.pid) this.pids.set(id, a.pid)
    switch (a.state) {
      case 'working':
        this.core.apply('generic', id, { type: 'turn.start', at }, { text: a.message })
        if (a.message) this.core.apply('generic', id, { type: 'info', at, info: { snippet: clip(a.message, 2000) } })
        break
      case 'idle':
        this.core.apply('generic', id, { type: 'turn.end', at, ...(a.message ? { message: a.message } : {}) })
        break
      case 'ended':
        this.core.apply('generic', id, { type: 'session.end', at })
        this.pids.delete(id)
        break
      default:
        if (a.message) this.core.apply('generic', id, { type: 'info', at, info: { snippet: clip(a.message, 2000) } })
    }
    return { session: a.session, state: this.core.sessions.get(id)?.state ?? 'unknown' }
  }

  async ask(a: AskArgs, signal: AbortSignal): Promise<AskResult> {
    if (this.core.privacy === 'summary')
      throw new AskRefused(
        'This OS user has summary privacy, so no text leaves it and the phone could not show your question. ' +
          'Run `agentwatch setup --privacy full` to allow it.',
      )
    const own = !a.session
    const id = own ? `g:ask-${randomId(8)}` : `g:${a.session}`
    this.touch(id, this.info({ title: a.title ?? (own ? clip(a.question, 80) : undefined), cwd: a.cwd }))
    const choices = a.choices ?? ['Yes', 'No']
    const req = this.core.openRequest({
      agent: 'generic',
      sessionId: id,
      kind: a.approve ? 'permission' : 'question',
      info: a.approve
        ? { title: a.question, ...(a.detail ? { detail: a.detail } : {}) }
        : {
            title: a.question,
            ...(a.detail ? { detail: a.detail } : {}),
            questions: [{ question: a.question, options: choices.map((label) => ({ label })), multiSelect: a.multi }],
          },
      answerable: true,
      timeoutMs: a.timeoutMs,
    })
    const cancel = () => this.core.close(req.id, 'cancelled')
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const out = await req.done
      if (out.type === 'closed')
        return { status: out.status === 'expired' || out.status === 'cancelled' ? out.status : 'answered_locally' }
      const b = out.body
      if (b.kind === 'decide')
        return b.behavior === 'allow'
          ? { status: 'approved' }
          : { status: 'denied', ...(b.message ? { message: b.message } : {}) }
      if (b.kind === 'answer')
        return { status: 'answered', answers: pickedChoices(b.answers[a.question] ?? '', choices) }
      return { status: 'cancelled' }
    } finally {
      signal.removeEventListener('abort', cancel)
      if (own) this.core.apply('generic', id, { type: 'session.end', at: this.now() })
    }
  }

  /** End sessions whose process is gone, or that nobody has reported on for a day. */
  sweep(): void {
    const alive = this.o.pidAlive ?? pidAlive
    const now = this.now()
    for (const s of this.core.sessions.values()) {
      if (s.agent !== 'generic' || s.state === 'ended') continue
      const pid = this.pids.get(s.id)
      const gone = pid !== undefined && !alive(pid)
      if (gone || (s.state !== 'needs_you' && now - s.updatedAt > STALE_MS)) {
        this.o.log('info', 'generic session ended', { session: s.id, reason: gone ? 'process exited' : 'stale' })
        this.core.apply('generic', s.id, { type: 'session.end', at: now })
        this.pids.delete(s.id)
      }
    }
  }
}
