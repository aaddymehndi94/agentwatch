// A request ticket: what the agent wants, the literal proof, how long it has waited, and the decision.

import type { SourceView } from '@agentwatch/protocol'
import { useState } from 'preact/hooks'
import { agentLabel, projectName, type RequestVM, type SessionVM, sourceLabel } from '../lib/model.ts'
import { clearPending, type Pending, sendCommand } from '../lib/store.ts'
import { clock, duration, heat } from '../lib/time.ts'
import { Alert, Check, Cross, Offline } from './icons.tsx'

function heatStyle(h: number): Record<string, string> {
  // neutral → amber over the first half of the log scale, amber → red over the second.
  const color =
    h < 0.5
      ? `color-mix(in oklab, var(--heat-1) ${Math.round(h * 200)}%, var(--heat-0))`
      : `color-mix(in oklab, var(--heat-2) ${Math.round((h - 0.5) * 200)}%, var(--heat-1))`
  const text = h < 0.35 ? 'var(--ink)' : h < 0.7 ? 'var(--amber-ink)' : 'var(--red-ink)'
  return { '--h': h.toFixed(3), '--heat': color, '--heat-text': text }
}

export function Ticket(props: {
  req: RequestVM
  session: SessionVM | undefined
  source: SourceView | undefined
  now: number
  pending: Pending | undefined
  showWhere?: boolean
}) {
  const { req, session, source, now, pending } = props
  const waited = now - req.createdAt
  const isQuestion = req.kind === 'question'
  const who = agentLabel(session?.agent ?? 'claude')
  const kindLabel = isQuestion ? `${who} has a question` : `${who} needs approval`

  return (
    <article class="ticket" style={heatStyle(heat(waited))} aria-label={`${kindLabel}, waiting ${duration(waited)}`}>
      <header class="ticket-head">
        <span class="ticket-kind">{kindLabel}</span>
        <span class="ticket-timer" title="Waiting for">
          {duration(waited)}
        </span>
      </header>
      <div class="timer-track" aria-hidden="true">
        <div class="timer-fill" />
      </div>
      <p class="ticket-where">
        {props.showWhere !== false && <strong>{session ? projectName(session) : 'Session'}</strong>}
        {props.showWhere !== false && `${sourceLabel(source)} · `}
        <span class="ticket-no">
          #{req.seq} · {clock(req.createdAt)}
        </span>
      </p>
      <Body {...props} />
      {source && !source.online && req.status === 'open' && !pending && (
        <div class="ticket-status">
          <Offline />
          <p>
            {sourceLabel(source)} is offline. An answer reaches it only if it reconnects within 5 minutes; until then,
            the agent keeps waiting.
          </p>
        </div>
      )}
      <Footer req={req} session={session} pending={pending} />
    </article>
  )
}

/** Literal text (a command, a path) that wraps only between tokens, so `--env` never splits into `-` / `-env`. Copying
 * it gives back exactly the original. Tokens too long for a line still break anywhere. */
function Literal({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((t, i) =>
        t.length > 0 && t.length <= 36 && !/\s/.test(t) ? (
          <span key={i} class="tok">
            {t}
          </span>
        ) : (
          t
        ),
      )}
    </>
  )
}

function Body({ req }: { req: RequestVM }) {
  const info = req.info
  if (!info) return <p class="hidden-note">This request couldn’t be decrypted on this phone.</p>
  // Agents with a tool (Claude, Codex) put it in `tool` and the literal in `detail`. A script's `agentwatch ask`
  // puts its own question in `title`.
  const asked = !info.tool && req.kind === 'permission' ? <p class="question">{info.title}</p> : null
  const detail = info.detail ? (
    <pre class="proof">
      <span class="proof-label">{info.tool ?? 'Details'}</span>
      <Literal text={info.detail} />
    </pre>
  ) : null
  if (req.kind === 'question') {
    if (!info.questions?.length) {
      return <p class="hidden-note">Details stay on the computer (summary privacy). Answer it there.</p>
    }
    return detail // the question itself is rendered by the footer, which owns the selection
  }
  if (!detail && !asked) {
    return (
      <p class="hidden-note">
        Wants to use <strong>{info.tool ?? 'a tool'}</strong>. Details stay on the computer (summary privacy).
      </p>
    )
  }
  return (
    <>
      {asked}
      {detail}
    </>
  )
}

function Footer({ req, session, pending }: { req: RequestVM; session: SessionVM | undefined; pending?: Pending }) {
  if (pending) return <PendingStatus id={req.id} pending={pending} />
  // A request this phone can't open is one it can't vouch for, so it gets no buttons.
  if (!req.answerable || !req.info) {
    return (
      <div class="ticket-status">
        <Alert />
        <p>Answer this one at the computer.</p>
      </div>
    )
  }
  if (req.kind === 'question' && req.info?.questions?.length) return <Answer req={req} session={session} />
  if (req.kind === 'question') return null
  const decide = (behavior: 'allow' | 'deny') =>
    sendCommand({
      key: req.id,
      label: behavior === 'allow' ? 'Approved' : 'Denied',
      sourceId: req.sourceId,
      sessionId: req.sessionId,
      requestId: req.id,
      body: { kind: 'decide', behavior },
    })
  return (
    <div class="actions">
      <button type="button" class="btn" onClick={() => decide('deny')}>
        <Cross />
        Deny
      </button>
      <button type="button" class="btn primary" onClick={() => decide('allow')}>
        <Check />
        Approve
      </button>
    </div>
  )
}

function Answer({ req }: { req: RequestVM; session: SessionVM | undefined }) {
  const questions = req.info?.questions ?? []
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const complete = questions.every((q) => (picked[q.question]?.length ?? 0) > 0)
  const toggle = (q: string, label: string, multi: boolean) =>
    setPicked((p) => {
      const cur = p[q] ?? []
      const next = multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label]
      return { ...p, [q]: next }
    })
  const send = () => {
    const answers = Object.fromEntries(questions.map((q) => [q.question, (picked[q.question] ?? []).join(', ')]))
    void sendCommand({
      key: req.id,
      label: 'Answered',
      sourceId: req.sourceId,
      sessionId: req.sessionId,
      requestId: req.id,
      body: { kind: 'answer', answers },
    })
  }
  return (
    <>
      {questions.map((q) => (
        <fieldset key={q.question} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend class="question">{q.question}</legend>
          <div class="options" role={q.multiSelect ? 'group' : 'radiogroup'}>
            {q.options.map((o) => {
              const on = picked[q.question]?.includes(o.label) ?? false
              return (
                // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is radio or checkbox; both take aria-checked
                <button
                  type="button"
                  key={o.label}
                  class={`option ${q.multiSelect ? 'multi' : ''}`}
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  onClick={() => toggle(q.question, o.label, q.multiSelect)}
                >
                  <span class="mark">{on && <Check />}</span>
                  <span>
                    <span class="option-label">{o.label}</span>
                    {o.description && <span class="option-desc">{o.description}</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
      <button type="button" class="btn primary block" disabled={!complete} onClick={send}>
        <Check />
        Send answer
      </button>
    </>
  )
}

function PendingStatus({ id, pending }: { id: string; pending: Pending }) {
  if (pending.status === 'sending' || pending.status === 'sent') {
    return (
      <div class="ticket-status" role="status">
        <span class="spinner" aria-hidden="true" />
        {pending.status === 'sending' ? 'Sending…' : `${pending.label}. Waiting for your computer…`}
      </div>
    )
  }
  if (pending.status === 'applied') {
    return (
      <div class="ticket-status" role="status">
        <Check />
        {pending.label}
      </div>
    )
  }
  return (
    <div class="ticket-status bad" role="alert">
      <Alert />
      <div>
        {pending.status === 'rejected' ? 'Not applied' : 'Couldn’t send'}
        {pending.detail && <p>{pending.detail}</p>}
      </div>
      <button type="button" class="btn quiet" style={{ marginLeft: 'auto' }} onClick={() => clearPending(id)}>
        OK
      </button>
    </div>
  )
}
