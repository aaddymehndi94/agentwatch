// One session: its open request(s), the last thing the agent said, a short timeline, and the reply composer.

import { useEffect, useState } from 'preact/hooks'
import { getEvents } from '../lib/api.ts'
import { demoEvents } from '../lib/demo.ts'
import {
  agentLabel,
  decryptEvents,
  type EventVM,
  projectName,
  STATE_LABEL,
  sessionKey,
  sourceLabel,
  vaultKey,
} from '../lib/model.ts'
import { type AppState, sendCommand } from '../lib/store.ts'
import { ago, clock, duration } from '../lib/time.ts'
import { Alert, Back, Check, Send } from '../ui/icons.tsx'
import { Ticket } from '../ui/ticket.tsx'

const EVENT_LABEL: Record<string, string> = {
  prompted: 'You asked',
  needs_you: 'Needed you',
  answered: 'Answered',
  done: 'Finished',
  ended: 'Ended',
  replied: 'You replied',
  started: 'Started',
}

export function SessionScreen(props: {
  app: AppState
  now: number
  sourceId: string
  sessionId: string
  go: (hash: string) => void
}) {
  const { app, now, sourceId, sessionId, go } = props
  const model = app.model
  const s = model?.sessions.find((x) => x.sourceId === sourceId && x.id === sessionId)
  const source = model?.sources.find((x) => x.id === sourceId)
  const requests = (model?.requests ?? []).filter(
    (r) => r.sourceId === sourceId && r.sessionId === sessionId && (r.status === 'open' || app.pending[r.id]),
  )
  const events = useEvents(app, sourceId, sessionId, s?.updatedAt ?? 0)
  const t = now + (model?.skew ?? 0)

  return (
    <>
      <header class="topbar">
        <button type="button" class="icon-btn" onClick={() => go('#/')} aria-label="Back to inbox">
          <Back />
        </button>
        <h1>
          <span class="title-text">{s ? projectName(s) : 'Session'}</span>
        </h1>
      </header>
      {!s ? (
        <div class="empty">
          <h2>This session is gone</h2>
          <p>It may have ended a while ago and been cleaned up.</p>
        </div>
      ) : (
        <div class="page">
          <div class="session-head">
            {s.info?.title && s.info.title !== projectName(s) && <h2>{s.info.title}</h2>}
            <p class="sub">
              <span class={`state ${s.state}`}>{STATE_LABEL[s.state]}</span>
              <span>
                {s.state === 'working' && s.turnStartedAt
                  ? `for ${duration(t - s.turnStartedAt)}`
                  : `since ${ago(s.stateSince, t)} ago`}
              </span>
              <span>{agentLabel(s.agent)}</span>
              <span class="mono">{sourceLabel(source)}</span>
            </p>
          </div>
          {requests.length > 0 && (
            <div class="session-tickets">
              {requests.map((r) => (
                <Ticket
                  key={r.id}
                  req={r}
                  session={s}
                  source={source}
                  now={t}
                  pending={app.pending[r.id]}
                  showWhere={false}
                />
              ))}
            </div>
          )}
          {s.info?.snippet && (
            <div class="last">
              <span class="proof-label">{s.state === 'working' ? 'Latest' : 'Last message'}</span>
              {s.info.snippet}
            </div>
          )}
          {events.length > 0 && (
            <>
              <div class="section-head" style={{ padding: 0 }}>
                <h2>Recent</h2>
              </div>
              <ol class="timeline">
                {events.map((e) => (
                  <li key={`${e.at}-${e.kind}`}>
                    <time dateTime={new Date(e.at).toISOString()}>{clock(e.at)}</time>
                    <div>
                      <span class="what">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                      {e.text && <span class="text">{e.text}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          <Composer app={app} sourceId={sourceId} sessionId={sessionId} />
        </div>
      )}
    </>
  )
}

function useEvents(app: AppState, sourceId: string, sessionId: string, version: number): EventVM[] {
  const [events, setEvents] = useState<EventVM[]>([])
  useEffect(() => {
    let live = true
    if (app.demo) {
      setEvents(demoEvents())
      return
    }
    const creds = app.creds
    if (!creds) return
    void (async () => {
      try {
        const raw = await getEvents(creds.token, sourceId, sessionId)
        const list = await decryptEvents(raw, sourceId, await vaultKey(creds.vaultKey))
        if (live) setEvents(list)
      } catch {}
    })()
    return () => {
      live = false
    }
  }, [app.creds, app.demo, sourceId, sessionId, version])
  return events
}

/** Common follow-ups. A tap fills the box, so nothing is sent until you press Send. */
const QUICK_REPLIES = ['Continue', 'Yes, go ahead', 'Summarize']

function Composer({ app, sourceId, sessionId }: { app: AppState; sourceId: string; sessionId: string }) {
  const s = app.model?.sessions.find((x) => x.sourceId === sourceId && x.id === sessionId)
  const [text, setText] = useState('')
  const key = `msg:${sessionKey(sourceId, sessionId)}`
  const pending = app.pending[key]
  if (!s || s.state === 'ended') return null
  if (!s.caps.reply) {
    return (
      <div class="composer">
        <p class="why">{s.caps.replyReason ?? 'Replies aren’t available for this session.'}</p>
      </div>
    )
  }
  const submit = async (e: Event) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    const ok = await sendCommand({ key, label: 'Sent', sourceId, sessionId, body: { kind: 'message', text: body } })
    if (ok) setText('')
  }
  return (
    <div class="composer">
      {!text && (
        <ul class="quick" aria-label="Quick replies">
          {QUICK_REPLIES.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => {
                  setText(q)
                  document.getElementById('reply')?.focus()
                }}
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit}>
        <label class="visually-hidden" for="reply">
          Reply to {agentLabel(s.agent)}
        </label>
        <textarea
          id="reply"
          rows={1}
          maxLength={8000}
          placeholder={`Reply to ${agentLabel(s.agent)}…`}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
        />
        <button
          type="submit"
          class="btn primary"
          disabled={!text.trim() || pending?.status === 'sending'}
          aria-label="Send"
          style={{ padding: '0 14px' }}
        >
          <Send />
        </button>
      </form>
      {pending && (
        <p class="note" role="status">
          {pending.status === 'applied' ? (
            <>
              <Check /> Delivered as your next prompt.
            </>
          ) : pending.status === 'rejected' || pending.status === 'failed' ? (
            <>
              <Alert /> {pending.detail ?? 'Not delivered.'}
            </>
          ) : (
            'Sending…'
          )}
        </p>
      )}
    </div>
  )
}
