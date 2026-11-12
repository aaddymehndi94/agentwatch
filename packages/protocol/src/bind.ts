// What each sealed blob is bound to (its associated data). Zod-free so the app and service worker can import it
// through `@agentwatch/protocol/lite` without pulling in the schema library.

import type { Binding } from './crypto.ts'
import type { CommandEnvelope } from './wire.ts'

export const bind = {
  session: (sourceId: string, sessionId: string): Binding => ({ kind: 'session', sourceId, sessionId }),
  request: (sourceId: string, sessionId: string, requestId: string): Binding => ({
    kind: 'request',
    sourceId,
    sessionId,
    requestId,
  }),
  event: (sourceId: string, e: { sessionId: string; at: number; kind: string }): Binding => ({
    kind: 'event',
    sourceId,
    sessionId: e.sessionId,
    at: e.at,
    ek: e.kind,
  }),
  push: (sourceId: string, tag: string): Binding => ({ kind: 'push', sourceId, tag }),
  command: (c: Omit<CommandEnvelope, 'sealed'>): Binding => ({
    kind: 'command',
    commandId: c.commandId,
    deviceId: c.deviceId,
    sourceId: c.sourceId,
    sessionId: c.sessionId,
    requestId: c.requestId,
    ck: c.kind,
    ts: c.ts,
    nonce: c.nonce,
  }),
}
