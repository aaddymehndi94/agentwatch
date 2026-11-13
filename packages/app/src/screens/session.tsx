// One session as a conversation: your prompts, the agent's replies (rendered Markdown), what it asked for and how
// that was answered, then anything still waiting on you and the reply composer.

import { readPrompt } from '@agentwatch/protocol/lite'
import type { ComponentChildren } from 'preact'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { getEvents } from '../lib/api.ts'
import { demoEvents } from '../lib/demo.ts'
import {
  agentLabel,
  decryptEvents,
  type EventVM,
  projectName,
  type SessionVM,
  STATE_LABEL,
  sessionKey,
  sourceLabel,
  vaultKey,
} from '../lib/model.ts'
import { type AppState, sendCommand } from '../lib/store.ts'
import { ago, clock, duration } from '../lib/time.ts'
import { TopBar } from '../ui/bar.tsx'
import { Alert, Check, Offline, Phone, Reply, Send, Stop, Terminal } from '../ui/icons.tsx'
import { Markdown } from '../ui/markdown.tsx'
import { Ticket } from '../ui/ticket.tsx'

type Item =
  | { k: 'you'; at: number; text: string; phone: boolean }
  | { k: 'agent'; at: number; text: string; latest: boolean }
  | { k: 'sys'; at: number; icon: 'ask' | 'ok' | 'end' | 'info' | 'msg'; label: string; text?: string }

/** The timeline, oldest first, plus the latest message if the timeline doesn't already end with it. */
function thread(events: EventVM[], s: SessionVM): Item[] {
  const items: Item[] = []
  for (const e of [...events].sort((a, b) => a.at - b.at)) {
    switch (e.kind) {
      case 'prompted': {
        // Claude Code submits its own notices (background tasks, other agents) as prompts: a quiet line, not you.
        const p = e.text ? readPrompt(e.text) : { from: 'you' as const, text: '' }
        if (!p) break
        items.push(
          p.from === 'agent'
            ? {
                k: 'sys',
                at: e.at,
                icon: p.kind === 'task-done' ? 'ok' : p.kind === 'agent' || p.kind === 'auto' ? 'msg' : 'info',
                label: p.label,
                ...(p.detail ? { text: p.detail } : {}),
              }
            : p.text
              ? { k: 'you', at: e.at, text: p.text, phone: false }
              : { k: 'sys', at: e.at, icon: 'info', label: 'You sent a prompt' },
        )
        break
      }
      case 'replied':
        items.push(
          e.text
            ? { k: 'you', at: e.at, text: e.text, phone: true }
            : { k: 'sys', at: e.at, icon: 'info', label: 'You replied' },
        )
        break
      case 'done':
        items.push(
          e.text
            ? { k: 'agent', at: e.at, text: e.text, latest: false }
            : { k: 'sys', at: e.at, icon: 'ok', label: 'Finished a turn' },
        )
        break
      case 'needs_you':
        items.push({ k: 'sys', at: e.at, icon: 'ask', label: 'Needed you', text: e.text })
        break
      case 'answered':
        items.push({ k: 'sys', at: e.at, icon: 'ok', label: e.text ?? 'Answered' })
        break
      case 'ended':
        items.push({ k: 'sys', at: e.at, icon: 'end', label: 'Session ended' })
        break
      default:
        items.push({ k: 'sys', at: e.at, icon: 'info', label: e.kind })
    }
  }
  const snippet = s.info?.snippet?.trim()
  if (snippet) {
    const lastAgent = [...items].reverse().find((i) => i.k === 'agent')
    if (!lastAgent || lastAgent.text.trim() !== snippet) {
      items.push({ k: 'agent', at: s.updatedAt, text: snippet, latest: s.state === 'working' })
    }
  }
  return items
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
          {s.state === 'working' && (
            <div class="working" role="status">
              <span class="orb" data-state="working" aria-hidden="true" />
              <span class="shimmer">{agentLabel(s.agent)} is working</span>
              {s.turnStartedAt && <span class="num">{duration(t - s.turnStartedAt)}</span>}
            </div>
          )}
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
      <div class="msg you">
        <div class="bubble">
          <Markdown text={item.text} />
        </div>
        <div class="msg-meta">
          {item.phone && (
            <>
              <Phone /> From your phone
              <span class="sep" aria-hidden="true" />
            </>
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
      {!text && (
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
          placeholder={`Reply to ${agentLabel(s.agent)}…`}
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
              <Check /> Delivered as your next prompt.
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
