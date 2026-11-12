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
}

export type AgentEvent =
  | { type: 'session.start'; at: number; info?: SessionInfo }
  | { type: 'turn.start'; at: number }
  | { type: 'request.open'; at: number; requestId: string }
  | { type: 'request.close'; at: number; requestId: string }
  | { type: 'turn.end'; at: number; message?: string }
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
      const next = withState({ ...s, turnStartedAt: e.at }, s.openRequests.length ? 'needs_you' : 'working', e.at)
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
      const turnMs = s.turnStartedAt !== null ? e.at - s.turnStartedAt : null
      const info = e.message !== undefined ? { ...s.info, snippet: e.message } : s.info
      const next = withState({ ...s, info, turnStartedAt: null, openRequests: [], lastTurnMs: turnMs }, 'idle', e.at)
      return { session: next, transition: { kind: 'done', turnMs } }
    }
    case 'session.end': {
      const next = withState({ ...s, openRequests: [], turnStartedAt: null }, 'ended', e.at)
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

/** Cut text to `max` characters on a word boundary, with an ellipsis. */
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

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max - 1)
  const sp = cut.lastIndexOf(' ')
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`
}
