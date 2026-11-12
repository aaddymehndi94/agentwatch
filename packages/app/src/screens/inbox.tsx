// Inbox: the rail of requests on top, then every session grouped by machine and OS user.

import type { SourceView } from '@agentwatch/protocol'
import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../lib/api.ts'
import {
  agentLabel,
  type Model,
  projectName,
  type SessionVM,
  STATE_LABEL,
  sessionKey,
  sourceLabel,
} from '../lib/model.ts'
import { type AppState, refresh, setMuteLocal } from '../lib/store.ts'
import { ago, clock } from '../lib/time.ts'
import { BellOff, Check, Gear, Offline } from '../ui/icons.tsx'
import { Ticket } from '../ui/ticket.tsx'

const STATE_ORDER: Record<string, number> = { needs_you: 0, working: 1, idle: 2, unknown: 3, ended: 4 }

export function Inbox({ app, now, go }: { app: AppState; now: number; go: (hash: string) => void }) {
  const model = app.model
  const online = model?.sources.filter((s) => s.online).length ?? 0
  const total = model?.sources.length ?? 0
  return (
    <>
      <header class="topbar">
        <h1>
          <span class="title-text">AgentWatch</span>
        </h1>
        {model && total > 0 && (
          <button type="button" class="machines" onClick={() => go('#/settings')} aria-label="Machines">
            <span class={`dot ${online === 0 ? 'off' : ''}`} />
            {online === total ? `${total} online` : `${online} of ${total} online`}
          </button>
        )}
        <button type="button" class="icon-btn" onClick={() => go('#/settings')} aria-label="Settings">
          <Gear />
        </button>
      </header>
      <Banners app={app} now={now} />
      {!model ? <Loading /> : <Board model={model} app={app} now={now} go={go} />}
    </>
  )
}

function Banners({ app, now }: { app: AppState; now: number }) {
  const mute = app.model?.mute
  return (
    <>
      {app.error && (
        <div class="banner" role="status">
          <Offline />
          <p>
            {app.error}
            {app.lastSync ? ` Showing what was known ${ago(app.lastSync, now)} ago.` : ''}
          </p>
          <button type="button" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      {mute && mute > now && (
        <div class="banner" role="status">
          <BellOff />
          <p>Notifications muted until {clock(mute)}.</p>
          <button
            type="button"
            onClick={async () => {
              setMuteLocal(null)
              if (app.creds) await api(app.creds.token, 'POST', '/api/mute', { until: null }).catch(() => {})
              void refresh()
            }}
          >
            Unmute
          </button>
        </div>
      )}
    </>
  )
}

function Loading() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" style={{ marginTop: 24 }}>
      <div class="skeleton" />
      <div class="skeleton" />
      <div class="skeleton" />
    </div>
  )
}

function Board({ model, app, now, go }: { model: Model; app: AppState; now: number; go: (hash: string) => void }) {
  const open = model.requests.filter((r) => r.status === 'open' || app.pending[r.id])
  const sessions = new Map(model.sessions.map((s) => [sessionKey(s.sourceId, s.id), s]))
  const sources = new Map(model.sources.map((s) => [s.id, s]))
  // Oldest wait first: the hottest ticket sits at the front of the rail.
  open.sort((a, b) => a.createdAt - b.createdAt)

  if (!model.sources.length) {
    return (
      <div class="empty">
        <h2>No computers connected yet</h2>
        <p>
          On your computer, run <code>agentwatch setup</code>. Your agents will show up here as soon as they start.
        </p>
      </div>
    )
  }

  return (
    <>
      <section class="rail-section" aria-labelledby="rail-h">
        {open.length === 0 ? (
          <h2 id="rail-h" class="rail-empty">
            <Check />
            Nothing waiting on you
          </h2>
        ) : (
          <div class="section-head">
            <h2 id="rail-h">
              Waiting on you
              <span class="count">{open.length}</span>
            </h2>
          </div>
        )}
        {open.length > 0 && (
          <Rail count={open.length}>
            {open.map((r) => (
              <Ticket
                key={r.id}
                req={r}
                session={sessions.get(sessionKey(r.sourceId, r.sessionId))}
                source={sources.get(r.sourceId)}
                now={now + model.skew}
                pending={app.pending[r.id]}
              />
            ))}
          </Rail>
        )}
      </section>
      {model.sources.map((src) => (
        <SourceGroup
          key={src.id}
          source={src}
          sessions={model.sessions.filter((s) => s.sourceId === src.id)}
          now={now + model.skew}
          go={go}
        />
      ))}
    </>
  )
}

function Rail({ count, children }: { count: number; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLElement>(null)
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => {
      const w = el.firstElementChild?.getBoundingClientRect().width ?? el.clientWidth
      setIndex(Math.round(el.scrollLeft / (w + 12)))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a horizontally scrolling region must be keyboard-focusable */}
      <section ref={ref} class={`rail ${count > 1 ? 'many' : ''}`} tabIndex={0} aria-label="Requests">
        {children}
      </section>
      {count > 1 && (
        <div class="rail-dots" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <span key={i} aria-current={i === Math.min(index, count - 1)} />
          ))}
        </div>
      )}
    </>
  )
}

function SourceGroup({
  source,
  sessions,
  now,
  go,
}: {
  source: SourceView
  sessions: SessionVM[]
  now: number
  go: (hash: string) => void
}) {
  const [showEnded, setShowEnded] = useState(false)
  const live = sessions
    .filter((s) => s.state !== 'ended')
    .sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || b.stateSince - a.stateSince)
  const ended = sessions.filter((s) => s.state === 'ended').sort((a, b) => b.stateSince - a.stateSince)
  return (
    <section aria-label={sourceLabel(source)} class={source.online ? undefined : 'stale'}>
      <div class="group-head">
        <span class={`dot ${source.online ? '' : 'off'}`} />
        <span class="who">{sourceLabel(source)}</span>
        <span class="meta">
          {source.online ? 'online' : `offline · ${ago(source.lastSeen, now)}`}
          {source.privacy === 'summary' ? ' · summary' : ''}
        </span>
      </div>
      {!source.online && live.length > 0 && <p class="stale-note">Showing what it last reported.</p>}
      <ul class="rows">
        {live.length === 0 && (
          <li class="more" style={{ cursor: 'default', display: 'flex', alignItems: 'center' }}>
            No running sessions.
          </li>
        )}
        {live.map((s) => (
          <Row key={s.key} s={s} now={now} go={go} />
        ))}
        {ended.length > 0 &&
          (showEnded ? (
            ended.map((s) => <Row key={s.key} s={s} now={now} go={go} />)
          ) : (
            <li>
              <button type="button" class="more" onClick={() => setShowEnded(true)}>
                {ended.length} ended
              </button>
            </li>
          ))}
      </ul>
    </section>
  )
}

function Row({ s, now, go }: { s: SessionVM; now: number; go: (hash: string) => void }) {
  return (
    <li>
      <button
        type="button"
        class={`row ${s.state}`}
        onClick={() => go(`#/s/${encodeURIComponent(s.sourceId)}/${encodeURIComponent(s.id)}`)}
      >
        <span class={`state ${s.state}`}>{STATE_LABEL[s.state]}</span>
        <span class="row-main">
          <span class="row-title">{s.info ? projectName(s) : 'Unreadable session'}</span>
          {s.info?.snippet && <span class="row-snippet">{s.info.snippet}</span>}
          {!s.info?.snippet && s.info?.title && s.info.title !== s.info.project && (
            <span class="row-snippet">{s.info.title}</span>
          )}
        </span>
        <span class="row-side">
          {agentLabel(s.agent)}
          <span class="age">{ago(s.stateSince, now)}</span>
        </span>
      </button>
    </li>
  )
}
