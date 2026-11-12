// Wire protocol v1: the messages between daemon (source), relay and app (device).
// Clear fields are ids, kinds, states and timestamps only. Everything a human wrote or would read is `sealed`.

import { z } from 'zod'

export const AgentKind = z.enum(['claude', 'codex', 'generic'])
export type AgentKind = z.infer<typeof AgentKind>

export const SessionState = z.enum(['working', 'needs_you', 'idle', 'ended', 'unknown'])
export type SessionState = z.infer<typeof SessionState>

export const Privacy = z.enum(['full', 'summary'])
export type Privacy = z.infer<typeof Privacy>

export const RequestKind = z.enum(['permission', 'question'])
export type RequestKind = z.infer<typeof RequestKind>

export const RequestStatus = z.enum(['open', 'answered', 'answered_locally', 'expired', 'cancelled'])
export type RequestStatus = z.infer<typeof RequestStatus>

export const EventKind = z.enum(['started', 'prompted', 'needs_you', 'answered', 'done', 'ended', 'replied'])
export type EventKind = z.infer<typeof EventKind>

const id = z.string().min(1).max(200)
const ts = z.number().int().nonnegative()

// ── Plaintext shapes that live inside sealed blobs ─────────────────────────────────────────────────────────────────

export const SessionInfo = z.object({
  title: z.string().max(300).optional(),
  project: z.string().max(200).optional(),
  cwd: z.string().max(1000).optional(),
  snippet: z.string().max(2000).optional(),
  model: z.string().max(100).optional(),
})
export type SessionInfo = z.infer<typeof SessionInfo>

export const Question = z.object({
  question: z.string(),
  header: z.string().optional(),
  options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  multiSelect: z.boolean().default(false),
})
export type Question = z.infer<typeof Question>

export const RequestInfo = z.object({
  title: z.string(),
  tool: z.string().optional(),
  detail: z.string().optional(),
  questions: z.array(Question).optional(),
})
export type RequestInfo = z.infer<typeof RequestInfo>

export const EventInfo = z.object({ text: z.string().max(2000).optional() })
export type EventInfo = z.infer<typeof EventInfo>

export const PushInfo = z.object({ title: z.string(), body: z.string() })
export type PushInfo = z.infer<typeof PushInfo>

// ── Clear wire objects ─────────────────────────────────────────────────────────────────────────────────────────────

export const Capabilities = z.object({
  /** Can a free-text message be delivered now? */
  reply: z.boolean(),
  /** Why not, shown in the composer. */
  replyReason: z.string().max(200).optional(),
})
export type Capabilities = z.infer<typeof Capabilities>

export const SessionWire = z.object({
  id,
  agent: AgentKind,
  state: SessionState,
  stateSince: ts,
  startedAt: ts,
  turnStartedAt: ts.nullable(),
  updatedAt: ts,
  caps: Capabilities,
  sealed: z.string().optional(),
})
export type SessionWire = z.infer<typeof SessionWire>

export const RequestWire = z.object({
  id,
  sessionId: id,
  kind: RequestKind,
  createdAt: ts,
  status: RequestStatus,
  closedAt: ts.nullable().optional(),
  /** Whether the phone can answer it (false e.g. for questions under summary privacy). */
  answerable: z.boolean(),
  sealed: z.string(),
})
export type RequestWire = z.infer<typeof RequestWire>

export const EventWire = z.object({ sessionId: id, at: ts, kind: EventKind, sealed: z.string().optional() })
export type EventWire = z.infer<typeof EventWire>

export const PushKind = z.enum(['needs_you', 'done', 'offline', 'test'])
export type PushKind = z.infer<typeof PushKind>

export const PushWire = z.object({
  tag: z.string().max(200),
  kind: PushKind,
  urgency: z.enum(['high', 'normal']),
  sessionId: id.optional(),
  requestId: id.optional(),
  /** Show Approve/Deny buttons (Android). */
  actions: z.boolean().default(false),
  sealed: z.string(),
})
export type PushWire = z.infer<typeof PushWire>

// ── Commands (device → relay → source) ─────────────────────────────────────────────────────────────────────────────

export const CommandKind = z.enum(['decide', 'answer', 'message'])
export type CommandKind = z.infer<typeof CommandKind>

export const CommandEnvelope = z.object({
  commandId: id,
  deviceId: id,
  sourceId: id,
  sessionId: id,
  requestId: id.optional(),
  kind: CommandKind,
  ts,
  nonce: z.string().min(16).max(64),
  sealed: z.string(),
})
export type CommandEnvelope = z.infer<typeof CommandEnvelope>

export const CommandBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('decide'),
    behavior: z.enum(['allow', 'deny']),
    message: z.string().max(2000).optional(),
  }),
  z.object({ kind: z.literal('answer'), answers: z.record(z.string(), z.string()) }),
  z.object({ kind: z.literal('message'), text: z.string().min(1).max(8000) }),
])
export type CommandBody = z.infer<typeof CommandBody>

export const CommandStatus = z.enum(['queued', 'sent', 'delivered', 'applied', 'rejected', 'expired'])
export type CommandStatus = z.infer<typeof CommandStatus>

// ── Source → relay messages ────────────────────────────────────────────────────────────────────────────────────────

export const SourceHello = z.object({
  t: z.literal('hello'),
  v: z.literal(1),
  host: z.string().max(200),
  user: z.string().max(200),
  privacy: Privacy,
  allowMessages: z.boolean(),
  daemonVersion: z.string().max(50),
  adapters: z.record(z.string(), z.string()),
})

export const SourceMessage = z.discriminatedUnion('t', [
  SourceHello,
  z.object({ t: z.literal('snapshot'), sessions: z.array(SessionWire), requests: z.array(RequestWire) }),
  z.object({ t: z.literal('session'), session: SessionWire }),
  z.object({ t: z.literal('event'), event: EventWire }),
  z.object({ t: z.literal('request.open'), request: RequestWire }),
  z.object({ t: z.literal('request.close'), requestId: id, status: RequestStatus, at: ts }),
  z.object({ t: z.literal('push'), push: PushWire }),
  z.object({
    t: z.literal('command.ack'),
    commandId: id,
    status: CommandStatus,
    detail: z.string().max(300).optional(),
  }),
  z.object({
    t: z.literal('pair.create'),
    rid: id,
    pairId: id,
    kind: z.enum(['device', 'source']),
    wrapped: z.string(),
    expiresAt: ts,
    meta: z.record(z.string(), z.string()).optional(),
  }),
])
export type SourceMessage = z.infer<typeof SourceMessage>

// ── Relay → source messages ────────────────────────────────────────────────────────────────────────────────────────

export const RelayMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('welcome'), sourceId: id, serverTime: ts, mute: ts.nullable() }),
  z.object({ t: z.literal('command'), command: CommandEnvelope }),
  z.object({ t: z.literal('settings'), mute: ts.nullable() }),
  z.object({ t: z.literal('ack'), rid: id, ok: z.boolean(), error: z.string().optional() }),
  z.object({ t: z.literal('error'), error: z.string() }),
])
export type RelayMessage = z.infer<typeof RelayMessage>

/** Auto-response keepalive (handled by the Hub without waking it). */
export const PING = 'ping'
export const PONG = 'pong'

// ── Device-facing API shapes ───────────────────────────────────────────────────────────────────────────────────────

export const SourceView = z.object({
  id,
  host: z.string(),
  user: z.string(),
  privacy: Privacy,
  allowMessages: z.boolean(),
  online: z.boolean(),
  lastSeen: ts,
  daemonVersion: z.string(),
  adapters: z.record(z.string(), z.string()),
})
export type SourceView = z.infer<typeof SourceView>

export const SessionView = SessionWire.extend({ sourceId: id })
export type SessionView = z.infer<typeof SessionView>

export const RequestView = RequestWire.extend({ sourceId: id })
export type RequestView = z.infer<typeof RequestView>

export const StateView = z.object({
  serverTime: ts,
  mute: ts.nullable(),
  sources: z.array(SourceView),
  sessions: z.array(SessionView),
  requests: z.array(RequestView),
})
export type StateView = z.infer<typeof StateView>

/** What the service worker receives in a Web Push message. */
export const PushPayload = z.object({
  v: z.literal(1),
  tag: z.string(),
  kind: PushKind,
  sourceId: id.optional(),
  sessionId: id.optional(),
  requestId: id.optional(),
  actions: z.boolean().optional(),
  /** Sealed PushInfo (from a source), absent for relay-made pushes (offline/test) which carry clear `title`/`body`. */
  sealed: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),
})
export type PushPayload = z.infer<typeof PushPayload>

// Bindings live in bind.ts (zod-free, shared with the app and service worker).
export { bind } from './bind.ts'
