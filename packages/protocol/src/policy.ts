// Notify policy: which transitions become a push, and what the push says. Evaluated in the daemon, before sealing,
// so `summary` privacy can strip free text at the source.

import { agentName, clip, type Session, type Transition } from './state.ts'
import type { Privacy, PushInfo, PushKind, RequestInfo } from './wire.ts'

export interface PolicyContext {
  privacy: Privacy
  /** Only turns at least this long push "done". */
  doneMinSeconds: number
  /** The request a needs_you transition is about, if known. */
  request?: RequestInfo
}

export interface PushIntent {
  kind: PushKind
  tag: string
  urgency: 'high' | 'normal'
  requestId?: string
  actions: boolean
  info: PushInfo
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function decide(session: Session, t: Transition, ctx: PolicyContext): PushIntent | null {
  const who = agentName(session.agent)
  const where = session.info.project ?? session.info.title ?? 'a session'
  const full = ctx.privacy === 'full'
  switch (t.kind) {
    case 'needs_you': {
      const r = ctx.request
      const isQuestion = !!r?.questions?.length
      const title = isQuestion ? `${who} has a question · ${where}` : `${who} needs approval · ${where}`
      let body: string
      if (full && r) {
        body = isQuestion ? clip(r.questions![0]!.question, 180) : clip(r.detail ?? r.title, 180)
      } else {
        body = isQuestion ? 'Open to answer.' : r?.tool ? `Wants to use ${r.tool}.` : 'Waiting for your decision.'
      }
      return {
        kind: 'needs_you',
        tag: `req:${t.requestId}`,
        urgency: 'high',
        requestId: t.requestId,
        actions: !isQuestion,
        info: { title, body },
      }
    }
    case 'done': {
      if (t.turnMs === null || t.turnMs < ctx.doneMinSeconds * 1000) return null
      const took = formatDuration(t.turnMs)
      const body = full && session.info.snippet ? clip(session.info.snippet, 180) : `Finished after ${took}.`
      return {
        kind: 'done',
        tag: `session:${session.id}`,
        urgency: 'normal',
        actions: false,
        info: { title: `${who} finished · ${where}`, body },
      }
    }
    default:
      return null
  }
}
