// Turns the relay's sealed StateView into what the screens show. Decryption happens here, on the phone; a blob that
// fails to open (wrong key, tampered, or bound to other ids) shows as "unreadable" rather than breaking the app.

import type {
  AgentKind,
  Capabilities,
  EventInfo,
  RequestInfo,
  RequestKind,
  RequestStatus,
  SessionInfo,
  SessionState,
  SourceView,
  StateView,
} from '@agentwatch/protocol'
import { bind, importVaultKey, open } from '@agentwatch/protocol/lite'

export interface SessionVM {
  key: string
  sourceId: string
  id: string
  agent: AgentKind
  state: SessionState
  stateSince: number
  startedAt: number
  turnStartedAt: number | null
  updatedAt: number
  caps: Capabilities
  info: SessionInfo | null
}

export interface RequestVM {
  sourceId: string
  id: string
  sessionId: string
  kind: RequestKind
  createdAt: number
  status: RequestStatus
  closedAt: number | null
  answerable: boolean
  info: RequestInfo | null
  /** Ticket number: arrival order among the requests the relay still knows. */
  seq: number
}

export interface EventVM {
  at: number
  kind: string
  text?: string
}

export interface Model {
  serverTime: number
  /** Offset to add to Date.now() to get relay time. */
  skew: number
  mute: number | null
  sources: SourceView[]
  sessions: SessionVM[]
  requests: RequestVM[]
}

export const sessionKey = (sourceId: string, id: string) => `${sourceId}/${id}`

const keyCache = new Map<string, Promise<CryptoKey>>()
export function vaultKey(raw: string): Promise<CryptoKey> {
  let k = keyCache.get(raw)
  if (!k) {
    k = importVaultKey(raw)
    keyCache.set(raw, k)
  }
  return k
}

async function tryOpen<T>(
  key: CryptoKey,
  sealed: string | undefined,
  b: Parameters<typeof open>[2],
): Promise<T | null> {
  if (!sealed) return null
  try {
    return await open<T>(key, sealed, b)
  } catch {
    return null
  }
}

export async function decryptState(raw: StateView, key: CryptoKey): Promise<Model> {
  const sessions = await Promise.all(
    raw.sessions.map(async (s) => ({
      key: sessionKey(s.sourceId, s.id),
      sourceId: s.sourceId,
      id: s.id,
      agent: s.agent,
      state: s.state,
      stateSince: s.stateSince,
      startedAt: s.startedAt,
      turnStartedAt: s.turnStartedAt,
      updatedAt: s.updatedAt,
      caps: s.caps,
      info: await tryOpen<SessionInfo>(key, s.sealed, bind.session(s.sourceId, s.id)),
    })),
  )
  const ordered = [...raw.requests].sort((a, b) => a.createdAt - b.createdAt)
  const requests = await Promise.all(
    ordered.map(async (r, i) => ({
      sourceId: r.sourceId,
      id: r.id,
      sessionId: r.sessionId,
      kind: r.kind,
      createdAt: r.createdAt,
      status: r.status,
      closedAt: r.closedAt ?? null,
      answerable: r.answerable,
      info: await tryOpen<RequestInfo>(key, r.sealed, bind.request(r.sourceId, r.sessionId, r.id)),
      seq: i + 1,
    })),
  )
  return {
    serverTime: raw.serverTime,
    skew: raw.serverTime - Date.now(),
    mute: raw.mute,
    sources: raw.sources,
    sessions,
    requests,
  }
}

export async function decryptEvents(
  events: { sessionId: string; at: number; kind: string; sealed?: string }[],
  sourceId: string,
  key: CryptoKey,
): Promise<EventVM[]> {
  return Promise.all(
    events.map(async (e) => {
      const info = await tryOpen<EventInfo>(key, e.sealed, bind.event(sourceId, e))
      return { at: e.at, kind: e.kind, ...(info?.text ? { text: info.text } : {}) }
    }),
  )
}

export function sourceLabel(s: SourceView | undefined): string {
  if (!s) return 'Unknown machine'
  if (!s.user && !s.host) return 'New machine'
  return `${s.user}@${s.host}`
}

export function projectName(s: SessionVM): string {
  return s.info?.project ?? s.info?.title ?? 'Session'
}

export function agentLabel(a: AgentKind): string {
  return a === 'claude' ? 'Claude' : a === 'codex' ? 'Codex' : 'Agent'
}

export const STATE_LABEL: Record<SessionState, string> = {
  needs_you: 'Needs you',
  working: 'Working',
  idle: 'Idle',
  ended: 'Ended',
  unknown: 'Unknown',
}
