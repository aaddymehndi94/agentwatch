// The session state machine. Adapters turn agent-specific signals (Claude hooks, Codex app-server events, `emit`)
// into AgentEvents; `reduce` folds them into a Session and reports the Transition that the notify policy reads.

import type { AgentKind, Capabilities, SessionInfo, SessionState } from './wire.ts'

export interface Session {
  id: string
  agent: AgentKind
  state: SessionState
  stateSince: number
  startedAt: number
  turnStartedAt: number | null
  updatedAt: number
  info: SessionInfo
  openRequests: string[]
  caps: Capabilities
  /** Duration of the last completed turn, ms. */
  lastTurnMs: number | null
  /**
   * Background tasks (subagents, shells, monitors, workflows) still running after the agent's turn ended. While any
   * are, the session is working, not idle: the agent hasn't finished, it's waiting on its own work.
   */
  background: number
}

export type AgentEvent =
  | { type: 'session.start'; at: number; info?: SessionInfo }
  | { type: 'turn.start'; at: number }
  | { type: 'request.open'; at: number; requestId: string }
  | { type: 'request.close'; at: number; requestId: string }
  /** `background`: labels of the agent's own work still running; non-empty means the job isn't finished yet. */
  | { type: 'turn.end'; at: number; message?: string; background?: string[] }
  | { type: 'session.end'; at: number }
  | { type: 'info'; at: number; info: SessionInfo }
  /** An external observation (e.g. `claude agents --json`), used to repair drift and discover sessions. */
  | { type: 'observed'; at: number; state: SessionState }

export type Transition =
  | { kind: 'started' }
  | { kind: 'prompted' }
  | { kind: 'needs_you'; requestId: string }
  | { kind: 'answered'; requestId: string }
  | { kind: 'done'; turnMs: number | null }
  /** The turn ended but the agent's background work runs on: no push, nothing is asked of you yet. */
  | { kind: 'waiting'; count: number }
  | { kind: 'ended' }

export function newSession(id: string, agent: AgentKind, at: number): Session {
  return {
    id,
    agent,
    state: 'unknown',
    stateSince: at,
    startedAt: at,
    turnStartedAt: null,
    updatedAt: at,
    info: {},
    openRequests: [],
    caps: { reply: false, replyReason: 'Not connected yet' },
    lastTurnMs: null,
    background: 0,
  }
}

function withState(s: Session, state: SessionState, at: number): Session {
  return state === s.state ? { ...s, updatedAt: at } : { ...s, state, stateSince: at, updatedAt: at }
}

function mergeInfo(a: SessionInfo, b: SessionInfo | undefined): SessionInfo {
  if (!b) return a
  const out: SessionInfo = { ...a }
  for (const [k, v] of Object.entries(b)) if (v !== undefined && v !== '') (out as Record<string, unknown>)[k] = v
  return out
}

export function reduce(s: Session, e: AgentEvent): { session: Session; transition: Transition | null } {
  if (s.state === 'ended' && e.type !== 'session.start') return { session: s, transition: null }
  switch (e.type) {
    case 'session.start': {
      const fresh = s.state === 'unknown' || s.state === 'ended'
      // A resume or compaction can restart a session that is blocked on you: it stays blocked.
      const next = withState(
        { ...s, info: mergeInfo(s.info, e.info) },
        s.openRequests.length ? 'needs_you' : s.state === 'working' ? 'working' : 'idle',
        e.at,
      )
      return { session: next, transition: fresh ? { kind: 'started' } : null }
    }
    case 'turn.start': {
      // A turn woken by the agent's own background work continues the same job: its clock keeps running.
      const continuing = (s.background ?? 0) > 0 && s.turnStartedAt !== null
      const turnStartedAt = continuing ? s.turnStartedAt : e.at
      const next = withState({ ...s, turnStartedAt }, s.openRequests.length ? 'needs_you' : 'working', e.at)
      return { session: next, transition: { kind: 'prompted' } }
    }
    case 'request.open': {
      if (s.openRequests.includes(e.requestId)) return { session: s, transition: null }
      const next = withState({ ...s, openRequests: [...s.openRequests, e.requestId] }, 'needs_you', e.at)
      return { session: next, transition: { kind: 'needs_you', requestId: e.requestId } }
    }
    case 'request.close': {
      if (!s.openRequests.includes(e.requestId)) return { session: s, transition: null }
      const openRequests = s.openRequests.filter((r) => r !== e.requestId)
      const state: SessionState = openRequests.length ? 'needs_you' : s.turnStartedAt !== null ? 'working' : 'idle'
      return {
        session: withState({ ...s, openRequests }, state, e.at),
        transition: { kind: 'answered', requestId: e.requestId },
      }
    }
    case 'turn.end': {
      const { background: _was, ...rest } = s.info
      const said = e.message !== undefined ? { ...rest, snippet: e.message } : rest
      if (e.background?.length) {
        const info = { ...said, background: e.background }
        const next = withState({ ...s, info, openRequests: [], background: e.background.length }, 'working', e.at)
        return { session: next, transition: { kind: 'waiting', count: e.background.length } }
      }
      const turnMs = s.turnStartedAt !== null ? e.at - s.turnStartedAt : null
      const next = withState(
        { ...s, info: said, turnStartedAt: null, openRequests: [], lastTurnMs: turnMs, background: 0 },
        'idle',
        e.at,
      )
      return { session: next, transition: { kind: 'done', turnMs } }
    }
    case 'session.end': {
      const next = withState({ ...s, openRequests: [], turnStartedAt: null, background: 0 }, 'ended', e.at)
      return { session: next, transition: { kind: 'ended' } }
    }
    case 'info':
      return { session: { ...s, info: mergeInfo(s.info, e.info), updatedAt: e.at }, transition: null }
    case 'observed': {
      if (e.state === 'ended') return reduce(s, { type: 'session.end', at: e.at })
      // Only fill in what hooks didn't tell us: never override needs_you/working derived from live events.
      if (s.state === 'unknown') return { session: withState(s, e.state, e.at), transition: null }
      return { session: s, transition: null }
    }
  }
}

/** Display name of an agent kind. */
export function agentName(agent: AgentKind): string {
  return agent === 'claude' ? 'Claude' : agent === 'codex' ? 'Codex' : 'Agent'
}

/** Last path segment of a cwd, used as the project name. */
export function projectFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const parts = cwd.replace(/\/+$/, '').split('/')
  return parts[parts.length - 1] || cwd
}

/** The longest command or tool input shown on the phone. Anything longer is answered at the computer. */
export const DETAIL_MAX = 8000

/**
 * Literal text (a command, a tool's input) exactly as it will run, line breaks and all, so a second line can't hide
 * behind the first. Past `max` characters it is cut, and says so on a line of its own.
 */
export function literal(raw: string, max: number): { text: string; cut: boolean } {
  const text = visible(raw)
  if (text.length <= max) return { text, cut: false }
  return { text: `${text.slice(0, max)}\n… ${text.length - max} more characters not shown`, cut: true }
}

/** Invisible and direction-changing characters, which can make text read differently from what it does. */
const HIDDEN = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

/** Spell out invisible and bidi control characters as ⟨U+XXXX⟩, so a command reads in the order it runs. */
export function visible(text: string): string {
  return text.replace(HIDDEN, (c) => `⟨U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}⟩`)
}

/** One line: whitespace collapsed, cut to `max` characters on a word boundary, with an ellipsis. For titles and
 * notification bodies. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`
}

/** The longest message (an agent's reply, your prompt) sent to the phone. */
export const MESSAGE_MAX = 6000

/**
 * A message as written: line breaks, indentation and blank lines kept, so Markdown (lists, code blocks, tables)
 * survives to the phone. Trailing spaces go, and runs of blank lines shrink to one. Past `max` it is cut on a line or
 * word boundary, with an ellipsis.
 */
export function clipText(text: string, max: number): string {
  const t = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const nl = cut.lastIndexOf('\n')
  const sp = cut.lastIndexOf(' ')
  const at = nl > max * 0.8 ? nl : sp > max * 0.6 ? sp : cut.length
  return `${cut.slice(0, at).trimEnd()}…`
}
