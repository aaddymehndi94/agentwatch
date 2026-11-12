// What each sealed blob is bound to (its associated data). Zod-free so the app and service worker can import it
// through `@agentwatch/protocol/lite` without pulling in the schema library.

import type { Binding } from './crypto.ts'
import type { CommandEnvelope } from './wire.ts'

export const bind = {
  session: (sourceId: string, sessionId: string): Binding => ({ kind: 'session', sourceId, sessionId }),
  /** Bound to its kind too, so the relay can't dress a question up as a permission with Approve and Deny. */
  request: (sourceId: string, r: { sessionId: string; id: string; kind: string }): Binding => ({
    kind: 'request',
    sourceId,
    sessionId: r.sessionId,
    requestId: r.id,
    rk: r.kind,
  }),
  event: (sourceId: string, e: { sessionId: string; at: number; kind: string }): Binding => ({
    kind: 'event',
    sourceId,
    sessionId: e.sessionId,
    at: e.at,
    ek: e.kind,
  }),
  /**
   * Bound to every clear field the service worker acts on. Otherwise the relay could replay the sealed text of a
   * harmless request with another request's id, and Approve on the notification would approve that one.
   */
  push: (
    sourceId: string,
    p: { tag: string; kind: string; sessionId?: string; requestId?: string; actions?: boolean },
  ): Binding => ({
    kind: 'push',
    sourceId,
    tag: p.tag,
    pk: p.kind,
    sessionId: p.sessionId,
    requestId: p.requestId,
    actions: p.actions === true,
  }),
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
