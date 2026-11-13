// One session as a conversation: your prompts, the agent's replies (rendered Markdown), what it asked for and how
// that was answered, then anything still waiting on you and the reply composer.

import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getEvents } from '../lib/api.ts'
import { demoEvents } from '../lib/demo.ts'
import {
  agentLabel,
  backgroundWork,
  decryptEvents,
  type EventVM,
  projectName,
  type SessionVM,
  STATE_LABEL,
  sessionKey,
  sourceLabel,
  splitBackgroundLabel,
  vaultKey,
} from '../lib/model.ts'
import { type AppState, sendCommand } from '../lib/store.ts'
import { type Item, thread } from '../lib/thread.ts'
import { ago, clock, duration } from '../lib/time.ts'
import { TopBar } from '../ui/bar.tsx'
import { Alert, Check, Clock, Offline, Phone, Reply, Send, Stop, Terminal } from '../ui/icons.tsx'
import { Markdown } from '../ui/markdown.tsx'
import { Ticket } from '../ui/ticket.tsx'

/** The live line under the thread: working, or waiting on background work (and on what, when the labels came). */
function Working({ s, elapsed }: { s: SessionVM; elapsed: number | null }) {
  const labels = (s.background > 0 ? (s.info?.background ?? []) : []).map(splitBackgroundLabel)
  // The line above already names the kind when they are all one kind ("2 background agents").
  const mixed = new Set(labels.map((l) => l.kind)).size > 1
  return (
    <div class="working-wrap" role="status">
      <div class="working">
        <span class="orb" data-state="working" aria-hidden="true" />
        <span class="shimmer">
          {s.background > 0
            ? `Waiting on ${backgroundWork(s.background, s.info?.background)}`
            : `${agentLabel(s.agent)} is working`}
        </span>
        {elapsed !== null && <span class="num">{duration(elapsed)}</span>}
      </div>
      {labels.length > 0 && (
        <ul class="bg-tasks">
          {labels.map(({ kind, what }, i) => (
            <li key={i}>
              {(mixed || !what) && <span class="bg-kind">{kind}</span>}
              {what && <span class="bg-what">{what}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
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
  const { events, loaded } = useEvents(app, sourceId, sessionId, s?.updatedAt ?? 0)
  const t = now + (model?.skew ?? 0)
  const items = s ? thread(events, s) : []
  const opened = useRef(false)
  const seen = useRef(0)
  // Measured before this render lands: were you reading the newest message?
  const atBottom = innerHeight + scrollY >= document.documentElement.scrollHeight - 96

  // Open at the newest message once the timeline is in, then follow new ones only while you're at the bottom.
  useLayoutEffect(() => {
    if (!s || !loaded) return
    const count = items.length + requests.length
    if (opened.current && count === seen.current) return
    if (!opened.current || atBottom) scrollTo({ top: document.documentElement.scrollHeight })
    opened.current = true
    seen.current = count
  })

  return (
    <>
      <TopBar
        back={() => go('#/')}
        title={s ? projectName(s) : 'Session'}
        sub={
          s && (
            <>
              <span class="orb small" data-state={s.state} aria-hidden="true" />
              <span class="state-word" data-state={s.state}>
                {STATE_LABEL[s.state]}
              </span>
              <span class="sep" aria-hidden="true" />
              {agentLabel(s.agent)}
              <span class="sep" aria-hidden="true" />
              <span class="mono">{sourceLabel(source)}</span>
            </>
          )
        }
      />
      {!s ? (
        <div class="empty">
          <h1>This session is gone</h1>
          <p>It may have ended a while ago and been cleaned up.</p>
        </div>
      ) : (
        <div class="convo">
          {source && !source.online && (
            <div class="banner" role="status">
              <Offline />
              <p>
                {sourceLabel(source)} has been offline for {ago(source.lastSeen, t)}. This is what it last reported.
              </p>
            </div>
          )}
          {s.info?.title && s.info.title !== projectName(s) && (
            <header class="convo-head">
              <h1>{s.info.title}</h1>
              <p>
                Started {clock(s.startedAt)}
                <span class="sep" aria-hidden="true" />
                {s.state === 'ended'
                  ? `Ended ${ago(s.stateSince, t)} ago`
                  : `${STATE_LABEL[s.state]} for ${
                      s.state === 'working' && s.turnStartedAt ? duration(t - s.turnStartedAt) : ago(s.stateSince, t)
                    }`}
              </p>
            </header>
          )}
          {items.length === 0 && requests.length === 0 && (
            <p class="convo-empty">
              Nothing here yet. Your prompts, {agentLabel(s.agent)}’s replies and anything it asks for appear as they
              happen.
            </p>
          )}
          <ol class="thread">
            {items.map((it, i) => (
              <li key={`${it.at}-${i}`}>
                <Message item={it} agent={agentLabel(s.agent)} />
              </li>
            ))}
          </ol>
          {s.state === 'working' && <Working s={s} elapsed={s.turnStartedAt ? t - s.turnStartedAt : null} />}
          {requests.length > 0 && (
            <div class="stack">
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
          <Composer app={app} s={s} offline={!!source && !source.online} />
        </div>
      )}
    </>
  )
}

function Message({ item, agent }: { item: Item; agent: string }): ComponentChildren {
  if (item.k === 'you') {
    return (
      <div class={`msg you${item.queued ? ' queued' : ''}`}>
        <div class="bubble">
          <Markdown text={item.text} />
        </div>
        <div class="msg-meta">
          {item.queued ? (
            <>
              <Clock /> Queued for after this turn
              <span class="sep" aria-hidden="true" />
            </>
          ) : (
            item.phone && (
              <>
                <Phone /> From your phone
                <span class="sep" aria-hidden="true" />
              </>
            )
          )}
          <time dateTime={new Date(item.at).toISOString()}>{clock(item.at)}</time>
        </div>
      </div>
    )
  }
  if (item.k === 'agent') {
    return (
      <div class="msg agent">
        <div class="msg-head">
          <span class="avatar" aria-hidden="true">
            {agent[0]}
          </span>
          <span class="who">{agent}</span>
          <time dateTime={new Date(item.at).toISOString()}>{item.latest ? 'Latest' : clock(item.at)}</time>
        </div>
        <Markdown text={item.text} class="agent-md" />
      </div>
    )
  }
  return (
    <div class={`sys ${item.icon}`}>
      <span class="sys-icon" aria-hidden="true">
        {item.icon === 'ask' ? (
          <Terminal />
        ) : item.icon === 'ok' ? (
          <Check />
        ) : item.icon === 'end' ? (
          <Stop />
        ) : item.icon === 'msg' ? (
          <Reply />
        ) : (
          <Alert />
        )}
      </span>
      <span class="sys-main">
        <span class="sys-label">{item.label}</span>
        {item.text && <code class="sys-text">{item.text}</code>}
      </span>
      <time dateTime={new Date(item.at).toISOString()}>{clock(item.at)}</time>
    </div>
  )
}

function useEvents(
  app: AppState,
  sourceId: string,
  sessionId: string,
  version: number,
): { events: EventVM[]; loaded: boolean } {
  const [events, setEvents] = useState<EventVM[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    if (app.demo) {
      setEvents(demoEvents(Date.now(), sessionId))
      setLoaded(true)
      return
    }
    const creds = app.creds
    if (!creds) return
    void (async () => {
      try {
        const raw = await getEvents(creds.token, sourceId, sessionId)
        const list = await decryptEvents(raw, sourceId, sessionId, await vaultKey(creds.vaultKey))
        if (live) setEvents(list)
      } catch {}
      if (live) setLoaded(true)
    })()
    return () => {
      live = false
    }
  }, [app.creds, app.demo, sourceId, sessionId, version])
  return { events, loaded }
}

/** Common follow-ups. A tap fills the box, so nothing is sent until you press Send. */
const QUICK_REPLIES = ['Continue', 'Yes, go ahead', 'Summarize what you did', 'Run the tests']

function Composer({ app, s, offline }: { app: AppState; s: SessionVM; offline: boolean }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const key = `msg:${sessionKey(s.sourceId, s.id)}`
  const pending = app.pending[key]
  // Grow with the text, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [text])
  if (s.state === 'ended') return null
  // Mid-turn, a reply waits for the turn (Claude) or joins it (Codex). Waiting on subagents, Claude itself is idle.
  const busy = (s.state === 'working' && s.background === 0) || s.state === 'needs_you'
  const busyMode = busy ? s.caps.busyReply : undefined
  const why =
    offline && !pending
      ? 'Replies can’t reach this computer while it’s offline.'
      : !s.caps.reply
        ? (s.caps.replyReason ?? 'Replies aren’t available for this session.')
        : null
  if (why) {
    return (
      <div class="composer">
        <p class="composer-why">{why}</p>
      </div>
    )
  }
  const submit = async (e: Event) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return
    const ok = await sendCommand({
      key,
      label: 'Sent',
      sourceId: s.sourceId,
      sessionId: s.id,
      body: { kind: 'message', text: body },
    })
    if (ok) setText('')
  }
  return (
    <div class="composer">
      {!text && !busyMode && (
        <ul class="quick" aria-label="Quick replies">
          {QUICK_REPLIES.map((q) => (
            <li key={q}>
              <button
                type="button"
                onClick={() => {
                  setText(q)
                  box.current?.focus()
                }}
              >
                {q}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} class="composer-box">
        <label class="visually-hidden" for="reply">
          Reply to {agentLabel(s.agent)}
        </label>
        <textarea
          id="reply"
          ref={box}
          rows={1}
          maxLength={8000}
          placeholder={
            busyMode === 'queue'
              ? 'Queue a reply for after this turn…'
              : busyMode === 'steer'
                ? `Add to ${agentLabel(s.agent)}’s current turn…`
                : `Reply to ${agentLabel(s.agent)}…`
          }
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit(e)
          }}
        />
        <button type="submit" class="send" disabled={!text.trim() || pending?.status === 'sending'} aria-label="Send">
          {pending?.status === 'sending' ? <span class="spinner" aria-hidden="true" /> : <Send />}
        </button>
      </form>
      {pending && pending.status !== 'sending' && (
        <p
          class={`composer-note ${pending.status === 'rejected' || pending.status === 'failed' ? 'bad' : ''}`}
          role="status"
        >
          {pending.status === 'applied' ? (
            <>
              <Check /> {pending.detail ? `${pending.detail}.` : 'Delivered as your next prompt.'}
            </>
          ) : pending.status === 'rejected' || pending.status === 'failed' ? (
            <>
              <Alert /> {pending.detail ?? 'Not delivered.'}
            </>
          ) : (
            'Sent. Waiting for your computer…'
          )}
        </p>
      )}
    </div>
  )
}
