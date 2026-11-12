// Claude Code adapter: turns plugin hook payloads into session state, and holds PermissionRequest hooks so the phone
// can answer them. The terminal dialog stays live while a hook is held (spike S1); whichever side answers first wins,
// and a local answer is recognised from the hooks that follow (PostToolUse, Stop, UserPromptSubmit, SessionEnd).

import { clip, projectFromCwd, type Question, type RequestInfo } from '@agentwatch/protocol'
import type { AgentAdapter, Core, Outcome } from '../daemon/core.ts'
import type { Logger } from '../log.ts'
import { ClaudeBridge, type Delivery, NOT_CONNECTED } from './claude-bridge.ts'

export interface ClaudeAdapterOptions {
  /** How long a PermissionRequest is held for the phone. Must stay under the plugin hook's own timeout. */
  holdMs: number
  log: Logger
  version?: string
}

type Payload = Record<string, unknown> & { hook_event_name?: string; session_id?: string; cwd?: string }

const DENY_MESSAGE = 'The user denied this from their phone.'

export class ClaudeAdapter implements AgentAdapter {
  readonly agent = 'claude' as const
  private seenVersion = ''
  /** Phone replies go out through the plugin's mod, which long-polls this bridge. */
  readonly bridge: ClaudeBridge

  constructor(
    private core: Core,
    private o: ClaudeAdapterOptions,
  ) {
    this.bridge = new ClaudeBridge({ onLink: (sid) => this.syncCaps(sid) })
  }

  message(sessionId: string, text: string): Promise<Delivery> {
    return this.bridge.send(sessionId, text)
  }

  stop(): void {
    this.bridge.stop()
  }

  private syncCaps(sid: string): void {
    this.core.setCaps(sid, this.bridge.connected(sid) ? { reply: true } : { reply: false, replyReason: NOT_CONNECTED })
  }

  describe(): string {
    return this.seenVersion ? `claude ${this.seenVersion}` : 'claude'
  }

  /**
   * Handle one hook call. Resolves with what the hook should print (empty = nothing). `signal` aborts when the hook
   * process goes away, which releases a held request.
   */
  async onHook(p: Payload, signal?: AbortSignal): Promise<string> {
    const event = p.hook_event_name
    const sid = typeof p.session_id === 'string' ? p.session_id : ''
    if (!event || !sid) return ''
    const now = Date.now()
    const cwd = typeof p.cwd === 'string' ? p.cwd : undefined
    this.core.ensure('claude', sid, { cwd, project: projectFromCwd(cwd) })
    this.syncCaps(sid)

    switch (event) {
      case 'SessionStart': {
        const info = {
          cwd,
          project: projectFromCwd(cwd),
          model: str(p.model),
          title: str(p.session_title),
        }
        this.core.apply('claude', sid, { type: 'session.start', at: now, info })
        return ''
      }
      case 'UserPromptSubmit': {
        this.releaseAll(sid)
        const prompt = str(p.prompt)
        this.core.apply('claude', sid, { type: 'turn.start', at: now }, { text: prompt })
        if (!this.core.sessions.get(sid)?.info.title && prompt) {
          this.core.apply('claude', sid, { type: 'info', at: now, info: { title: clip(prompt, 80) } })
        }
        return ''
      }
      case 'PermissionRequest':
        return this.hold(sid, p, signal)
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'PermissionDenied':
        this.releaseMatching(sid, matchKey(p.tool_name, p.tool_input))
        return ''
      case 'Notification': {
        // permission_prompt duplicates a PermissionRequest we already hold; idle_prompt is noise.
        return ''
      }
      case 'Stop':
      case 'StopFailure': {
        this.releaseAll(sid)
        const msg = str(p.last_assistant_message)
        this.core.apply('claude', sid, { type: 'turn.end', at: now, ...(msg !== undefined ? { message: msg } : {}) })
        return ''
      }
      case 'SessionEnd': {
        this.releaseAll(sid, 'cancelled')
        this.core.apply('claude', sid, { type: 'session.end', at: now })
        return ''
      }
      default:
        return ''
    }
  }

  private async hold(sid: string, p: Payload, signal?: AbortSignal): Promise<string> {
    const tool = str(p.tool_name) ?? 'a tool'
    const input = isRecord(p.tool_input) ? p.tool_input : {}
    const questions = tool === 'AskUserQuestion' ? parseQuestions(input.questions) : undefined
    const info: RequestInfo = questions?.length
      ? { title: questions.length > 1 ? `${questions.length} questions` : 'Question', tool, questions }
      : { title: `Use ${tool}`, tool, detail: describeTool(tool, input) }
    const req = this.core.openRequest({
      agent: 'claude',
      sessionId: sid,
      kind: questions?.length ? 'question' : 'permission',
      info,
      timeoutMs: this.o.holdMs,
      match: matchKey(p.tool_name, p.tool_input),
    })
    const onAbort = () => this.core.close(req.id, 'answered_locally')
    if (signal?.aborted) onAbort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const outcome: Outcome = await req.done
    signal?.removeEventListener('abort', onAbort)
    return hookOutput(outcome, input)
  }

  private releaseMatching(sid: string, key: string): void {
    for (const r of this.core.openRequestsOf(sid)) if (r.match === key) this.core.close(r.id, 'answered_locally')
  }

  private releaseAll(sid: string, status: 'answered_locally' | 'cancelled' = 'answered_locally'): void {
    for (const r of this.core.openRequestsOf(sid)) this.core.close(r.id, status)
  }
}

/** The PermissionRequest hook's stdout for an outcome. Empty means "no opinion": the terminal dialog decides. */
export function hookOutput(outcome: Outcome, toolInput: Record<string, unknown>): string {
  if (outcome.type !== 'command') return ''
  const body = outcome.body
  const decision =
    body.kind === 'answer'
      ? { behavior: 'allow', updatedInput: { ...toolInput, answers: body.answers } }
      : body.behavior === 'allow'
        ? { behavior: 'allow' }
        : { behavior: 'deny', message: body.message?.trim() || DENY_MESSAGE }
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })
}

/** Identity of a tool call for matching a held request to the PostToolUse that follows a local answer. */
export function matchKey(tool: unknown, input: unknown): string {
  const rest = isRecord(input) ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'answers')) : input
  return `${String(tool)}\u0000${stableStringify(rest)}`
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (isRecord(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** A one-glance description of what a tool wants to do. */
export function describeTool(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  switch (tool) {
    case 'Bash':
      return clip(s('command') ?? '', 600)
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'Read':
    case 'NotebookEdit':
      return s('file_path') ?? s('notebook_path') ?? tool
    case 'WebFetch':
      return s('url') ?? tool
    case 'WebSearch':
      return s('query') ?? tool
    default: {
      const desc = s('description') ?? s('command') ?? s('prompt')
      if (desc) return clip(desc, 600)
      const json = JSON.stringify(input)
      return clip(json === '{}' ? tool : json, 600)
    }
  }
}

function parseQuestions(raw: unknown): Question[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Question[] = []
  for (const q of raw) {
    if (!isRecord(q) || typeof q.question !== 'string') continue
    const options = Array.isArray(q.options)
      ? q.options
          .filter(isRecord)
          .filter((o) => typeof o.label === 'string')
          .map((o) => ({
            label: o.label as string,
            ...(typeof o.description === 'string' ? { description: o.description } : {}),
          }))
      : []
    out.push({
      question: q.question,
      ...(typeof q.header === 'string' ? { header: q.header } : {}),
      options,
      multiSelect: q.multiSelect === true,
    })
  }
  return out
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v !== '' ? v : undefined
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
