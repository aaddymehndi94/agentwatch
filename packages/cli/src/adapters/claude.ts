// Claude Code adapter: turns plugin hook payloads into session state, and holds PermissionRequest hooks so the phone
// can answer them. The terminal dialog stays live while a hook is held (spike S1); whichever side answers first wins,
// and a local answer is recognised from the hooks that follow (PostToolUse, Stop, UserPromptSubmit, SessionEnd).

import {
  clip,
  DETAIL_MAX,
  isYourPrompt,
  literal,
  projectFromCwd,
  type Question,
  type RequestInfo,
  readPrompt,
} from '@agentwatch/protocol'
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
        // Claude Code also submits its own messages (background-task results, other agents' messages) as prompts.
        // They still start a turn, but only what you typed titles the session; the phone draws the rest as quiet
        // lines, and local command output isn't sent at all.
        const raw = str(p.prompt)
        const read = raw ? readPrompt(raw) : null
        const text = read?.from === 'you' ? read.text : read ? raw : undefined
        this.core.apply('claude', sid, { type: 'turn.start', at: now }, text !== undefined ? { text } : {})
        const title = this.core.sessions.get(sid)?.info.title
        if (read?.from === 'you' && !isYourPrompt(title)) {
          this.core.apply('claude', sid, { type: 'info', at: now, info: { title: clip(read.text, 80) } })
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
        // Subagents run in the background by default: a turn can end while they work. Then it isn't done.
        const background = event === 'Stop' ? backgroundLabels(p.background_tasks) : []
        this.core.apply('claude', sid, {
          type: 'turn.end',
          at: now,
          ...(msg !== undefined ? { message: msg } : {}),
          ...(background.length ? { background } : {}),
        })
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
    const described = questions?.length ? undefined : describeTool(tool, input)
    const info: RequestInfo = described
      ? { title: `Use ${tool}`, tool, detail: described.detail }
      : { title: questions!.length > 1 ? `${questions!.length} questions` : 'Question', tool, questions }
    const req = this.core.openRequest({
      agent: 'claude',
      sessionId: sid,
      kind: described ? 'permission' : 'question',
      info,
      // Too long to show in full: don't let the phone approve what it can't show.
      ...(described?.cut ? { answerable: false } : {}),
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

/**
 * The background work a turn waits on: subagents and workflows, which always come back and report. Background shells
 * and monitors don't count: a dev server or a log watcher can run for hours, and the turn really is over.
 */
const WAITS_ON: Record<string, string> = { subagent: 'Agent', workflow: 'Workflow' }
const FINISHED = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled', 'error'])

/**
 * One short line per subagent or workflow still running in `Stop`'s `background_tasks`:
 * "Agent · Explore: find the hook code", "Workflow · review-changes".
 */
export function backgroundLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .filter((t) => WAITS_ON[str(t.type) ?? ''] && !FINISHED.has(str(t.status) ?? ''))
    .slice(0, 20)
    .map((t) => {
      const what =
        t.type === 'subagent'
          ? [str(t.agent_type), str(t.description)].filter(Boolean).join(': ')
          : (str(t.name) ?? str(t.description))
      const kind = WAITS_ON[t.type as string]!
      return clip(what ? `${kind} · ${what}` : kind, 120)
    })
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

/**
 * Identity of a tool call for matching a held request to the PostToolUse that follows a local answer. A question is
 * identified by its questions alone: answering it adds fields to the input (`answers`, and `annotations` when it was
 * answered in the terminal), and a mismatch would leave it open on the phone until the turn ends.
 */
export function matchKey(tool: unknown, input: unknown): string {
  const rest =
    tool === 'AskUserQuestion' && isRecord(input)
      ? { questions: input.questions }
      : isRecord(input)
        ? Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'answers'))
        : input
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

/**
 * What a tool wants to do, as the literal the human approves: the exact command, the file and the change to it, the
 * URL, or the tool's full input. Never the agent's own `description` of it, which could say anything. `cut` means it
 * didn't fit, so it can only be answered at the computer.
 */
export function describeTool(tool: string, input: Record<string, unknown>): { detail: string; cut: boolean } {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const path = s('file_path') ?? s('notebook_path') ?? tool
  let raw: string
  switch (tool) {
    case 'Bash':
      raw = s('command') ?? ''
      break
    case 'Read':
      raw = path
      break
    case 'Write':
      raw = `${path}\n${diffLines('', s('content') ?? '')}`
      break
    case 'Edit':
      raw = `${path}${input.replace_all === true ? ' (every match)' : ''}\n${diffLines(s('old_string') ?? '', s('new_string') ?? '')}`
      break
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits.filter(isRecord) : []
      const str = (e: Record<string, unknown>, k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
      raw = [path, ...edits.map((e) => diffLines(str(e, 'old_string'), str(e, 'new_string')))].join('\n')
      break
    }
    case 'NotebookEdit': {
      const where = [s('cell_id') && `cell ${s('cell_id')}`, s('edit_mode')].filter(Boolean).join(', ')
      raw = `${path}${where ? ` (${where})` : ''}\n${diffLines('', s('new_source') ?? '')}`
      break
    }
    case 'WebFetch':
      raw = s('url') ?? tool
      break
    case 'WebSearch':
      raw = s('query') ?? tool
      break
    default:
      raw = Object.keys(input).length ? JSON.stringify(input, null, 2) : tool
  }
  const r = literal(raw, DETAIL_MAX)
  return { detail: r.text, cut: r.cut }
}

/** Old lines as `- `, new ones as `+ `: the whole change, not just the file it lands in. */
function diffLines(before: string, after: string): string {
  const lines = (t: string, mark: string) => (t ? t.split('\n').map((l) => `${mark} ${l}`) : [])
  return [...lines(before, '-'), ...lines(after, '+')].join('\n')
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
