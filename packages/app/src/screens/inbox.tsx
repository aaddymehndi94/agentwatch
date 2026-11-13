// Inbox: one line that says whether anything waits on you, the requests themselves, then every session grouped by
// machine and OS user.

import type { SourceView } from '@agentwatch/protocol'
import { useState } from 'preact/hooks'
import { api } from '../lib/api.ts'
import { plainText } from '../lib/markdown.ts'
import {
  agentLabel,
  backgroundWork,
  type Model,
  projectName,
  type RequestVM,
  type SessionVM,
  STATE_LABEL,
  sessionKey,
  sourceLabel,
} from '../lib/model.ts'
import { type AppState, refresh, setMuteLocal } from '../lib/store.ts'
import { ago, clock, duration } from '../lib/time.ts'
import { TopBar } from '../ui/bar.tsx'
import { BellOff, Chevron, Gear, Laptop, Mark, Offline } from '../ui/icons.tsx'
import { Ticket } from '../ui/ticket.tsx'

const STATE_ORDER: Record<string, number> = { needs_you: 0, working: 1, idle: 2, unknown: 3, ended: 4 }

export function Inbox({ app, now, go }: { app: AppState; now: number; go: (hash: string) => void }) {
  const model = app.model
  const online = model?.sources.filter((s) => s.online).length ?? 0
  const total = model?.sources.length ?? 0
  return (
    <>
      <TopBar
        title={
          <span class="brand">
            <Mark size={26} />
            AgentWatch
          </span>
        }
      >
        {model && total > 0 && (
          <button type="button" class="pill" onClick={() => go('#/settings')} aria-label="Computers">
            <span class={`dot ${app.error || online === 0 ? 'off' : online < total ? 'part' : ''}`} />
            {app.error
              ? `Last known: ${online} of ${total}`
              : online === total
                ? `${total} online`
                : `${online} of ${total} online`}
          </button>
        )}
        <button type="button" class="icon-btn round" onClick={() => go('#/settings')} aria-label="Settings">
          <Gear />
        </button>
      </TopBar>
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
          <button type="button" class="btn quiet small" onClick={() => void refresh()}>
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
            class="btn quiet small"
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
    <div class="loading" role="status" aria-busy="true" aria-label="Loading">
      <div class="skeleton hero-skel" />
      <div class="skeleton" />
      <div class="skeleton" />
      <div class="skeleton" />
    </div>
  )
}

/** The one-line answer to "does anything need me?", and what everything else is doing. */
function Status({ model, open, now }: { model: Model; open: RequestVM[]; now: number }) {
  const live = model.sessions.filter((s) => s.state !== 'ended')
  const count = (st: string) => live.filter((s) => s.state === st).length
  const parts = [count('working') && `${count('working')} working`, count('idle') && `${count('idle')} idle`].filter(
    Boolean,
  ) as string[]
  let title: string
  let sub: string
  if (open.length) {
    const sessions = new Set(open.map((r) => sessionKey(r.sourceId, r.sessionId)))
    const first = model.sessions.find((s) => sessionKey(s.sourceId, s.id) === [...sessions][0])
    title =
      sessions.size === 1 ? `${agentLabel(first?.agent ?? 'claude')} needs you` : `${sessions.size} agents need you`
    sub = [`Waiting ${duration(now - open[0]!.createdAt)}`, ...parts].join(' · ')
  } else {
    title = 'All clear'
    sub = parts.length ? `Nothing waiting on you · ${parts.join(' · ')}` : 'Nothing waiting on you · no agents running'
  }
  return (
    <section class="status" aria-live="polite">
      <h1>{title}</h1>
      <p>{sub}</p>
    </section>
  )
}

function Board({ model, app, now, go }: { model: Model; app: AppState; now: number; go: (hash: string) => void }) {
  const open = model.requests.filter((r) => r.status === 'open' || app.pending[r.id])
  const sessions = new Map(model.sessions.map((s) => [sessionKey(s.sourceId, s.id), s]))
  const sources = new Map(model.sources.map((s) => [s.id, s]))
  const t = now + model.skew
  // Longest wait first.
  open.sort((a, b) => a.createdAt - b.createdAt)

  if (!model.sources.length) {
    return (
      <div class="empty">
        <Mark size={64} />
        <h1>No computers connected yet</h1>
        <p>
          On your computer, run <code>agentwatch setup</code>. Your agents show up here as soon as they start.
        </p>
      </div>
    )
  }

  return (
    <>
      <Status model={model} open={open} now={t} />
      {open.length > 0 && (
        <section class="stack" aria-label="Waiting on you">
          {open.map((r) => (
            <Ticket
              key={r.id}
              req={r}
              session={sessions.get(sessionKey(r.sourceId, r.sessionId))}
              source={sources.get(r.sourceId)}
              now={t}
              pending={app.pending[r.id]}
            />
          ))}
        </section>
      )}
      {model.sources.map((src) => (
        <SourceGroup
          key={src.id}
          source={src}
          sessions={model.sessions.filter((s) => s.sourceId === src.id)}
          stale={!!app.error}
          now={t}
          go={go}
        />
      ))}
    </>
  )
}

function SourceGroup({
  source,
  sessions,
  stale,
  now,
  go,
}: {
  source: SourceView
  sessions: SessionVM[]
  /** The relay can't be reached, so this is only what was last known. */
  stale: boolean
  now: number
  go: (hash: string) => void
}) {
  const [showEnded, setShowEnded] = useState(false)
  const live = sessions
    .filter((s) => s.state !== 'ended')
    .sort((a, b) => (STATE_ORDER[a.state] ?? 9) - (STATE_ORDER[b.state] ?? 9) || b.stateSince - a.stateSince)
  const ended = sessions.filter((s) => s.state === 'ended').sort((a, b) => b.stateSince - a.stateSince)
  return (
    <section aria-label={sourceLabel(source)} class={`group ${source.online && !stale ? '' : 'stale'}`}>
      <h2 class="group-head">
        <Laptop />
        <span class="who">{sourceLabel(source)}</span>
        <span class="group-meta">
          <span class={`dot ${source.online ? '' : 'off'}`} />
          {source.online ? 'Online' : `Offline ${ago(source.lastSeen, now)}`}
          {source.privacy === 'summary' ? ' · Private: states only' : ''}
        </span>
      </h2>
      {!source.online && live.length > 0 && <p class="group-note">Showing what it last reported.</p>}
      <ul class="list">
        {live.length === 0 && <li class="list-empty">No running sessions</li>}
        {live.map((s) => (
          <Row key={s.key} s={s} now={now} go={go} />
        ))}
        {ended.length > 0 &&
          (showEnded ? (
            ended.map((s) => <Row key={s.key} s={s} now={now} go={go} />)
          ) : (
            <li>
              <button type="button" class="row more" onClick={() => setShowEnded(true)}>
                Show {ended.length} ended {ended.length === 1 ? 'session' : 'sessions'}
              </button>
            </li>
          ))}
      </ul>
    </section>
  )
}

function Row({ s, now, go }: { s: SessionVM; now: number; go: (hash: string) => void }) {
  // A turn that ended with subagents still out isn't done: say what it waits on, not its last words.
  const waiting = s.state === 'working' && s.background > 0
  const text = waiting
    ? backgroundWork(s.background, s.info?.background)
    : s.info?.snippet
      ? plainText(s.info.snippet)
      : s.info?.title && s.info.title !== s.info.project
        ? s.info.title
        : ''
  return (
    <li>
      <button
        type="button"
        class="row"
        data-state={s.state}
        onClick={() => go(`#/s/${encodeURIComponent(s.sourceId)}/${encodeURIComponent(s.id)}`)}
      >
        <span class="orb" data-state={s.state} aria-hidden="true" />
        <span class="row-main">
          <span class="row-top">
            <span class="row-title">{s.info ? projectName(s) : 'Unreadable session'}</span>
            <span class="row-meta">
              {agentLabel(s.agent)}
              <span class="sep" aria-hidden="true" />
              <span class="num">{ago(s.stateSince, now)}</span>
            </span>
          </span>
          <span class="row-sub">
            <span class="state-word" data-state={s.state}>
              {waiting ? 'Waiting' : STATE_LABEL[s.state]}
            </span>
            {text && (
              <>
                <span class="sep" aria-hidden="true" />
                <span class="row-snippet">{text}</span>
              </>
            )}
          </span>
        </span>
        <Chevron />
      </button>
    </li>
  )
}
