// A request card: what the agent wants, the literal proof, how long it has waited, and the decision. Its edge is a
// slow-turning light whose colour heats from amber to red as the wait grows.

import type { SourceView } from '@agentwatch/protocol'
import { useState } from 'preact/hooks'
import { agentLabel, projectName, type RequestVM, type SessionVM, sourceLabel } from '../lib/model.ts'
import { clearPending, type Pending, sendCommand } from '../lib/store.ts'
import { duration, heat } from '../lib/time.ts'
import { Alert, Check, Clock, Cross, FileEdit, Offline, Question, Terminal } from './icons.tsx'
import { InlineMarkdown } from './markdown.tsx'

const EDIT_TOOLS = /^(Edit|MultiEdit|Write|NotebookEdit|apply_patch)$/

function heatStyle(h: number): Record<string, string> {
  // amber → orange over the first half of the log scale, orange → red over the second.
  const color =
    h < 0.5
      ? `color-mix(in oklab, var(--heat-1) ${Math.round(h * 200)}%, var(--heat-0))`
      : `color-mix(in oklab, var(--heat-2) ${Math.round((h - 0.5) * 200)}%, var(--heat-1))`
  return { '--h': h.toFixed(3), '--heat': color }
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
  const tool = req.info?.tool
  const hot = heat(waited)

  return (
    <article
      class={`req ${pending ? 'settling' : ''}`}
      data-heat={hot < 0.35 ? 0 : hot < 0.7 ? 1 : 2}
      style={heatStyle(hot)}
      aria-label={`${kindLabel}, waiting ${duration(waited)}`}
    >
      <header class="req-head">
        <span class="req-icon" aria-hidden="true">
          {isQuestion ? <Question /> : tool && EDIT_TOOLS.test(tool) ? <FileEdit /> : <Terminal />}
        </span>
        <span class="req-title">
          <span class="req-kind">{kindLabel}</span>
          {props.showWhere !== false && (
            <span class="req-where">
              {session ? projectName(session) : 'Session'}
              <span class="sep" aria-hidden="true" />
              <span class="mono">{sourceLabel(source)}</span>
            </span>
          )}
        </span>
        <span class="req-timer" title="Waiting for">
          <Clock />
          {duration(waited)}
        </span>
      </header>
      <Body {...props} />
      {source && !source.online && req.status === 'open' && !pending && (
        <div class="note">
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

/** Literal text (a command, a path) that wraps only between tokens, so `--env` never splits into `-` / `-env`. Tokens
 * too long for a line still break anywhere. */
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

/** The exact command or change, one line per row; an edit's removed and added lines are tinted. */
function Proof({ tool, detail }: { tool: string | undefined; detail: string }) {
  const edit = !!tool && EDIT_TOOLS.test(tool)
  const lines = detail.split('\n')
  return (
    <figure class="proof">
      <figcaption>{tool ?? 'Details'}</figcaption>
      <pre>
        {lines.map((l, i) => (
          <span
            key={i}
            class={`ln ${edit && i > 0 && l.startsWith('+') ? 'add' : edit && i > 0 && l.startsWith('-') ? 'del' : ''}`}
          >
            <Literal text={l} />
          </span>
        ))}
      </pre>
    </figure>
  )
}

function Body({ req }: { req: RequestVM }) {
  const info = req.info
  if (!info) return <p class="muted-note">This request couldn’t be decrypted on this phone.</p>
  // Agents with a tool (Claude, Codex) put it in `tool` and the literal in `detail`. A script's `agentwatch ask`
  // puts its own question in `title`.
  const asked =
    !info.tool && req.kind === 'permission' ? (
      <p class="question">
        <InlineMarkdown text={info.title} />
      </p>
    ) : null
  const detail = info.detail ? <Proof tool={info.tool} detail={info.detail} /> : null
  if (req.kind === 'question') {
    if (!info.questions?.length) {
      return <p class="muted-note">Details stay on the computer (summary privacy). Answer it there.</p>
    }
    return detail // the question itself is rendered by the footer, which owns the selection
  }
  if (!detail && !asked) {
    return (
      <p class="muted-note">
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
      <div class="note">
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
      <button type="button" class="btn ghost" onClick={() => decide('deny')}>
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
        <fieldset key={q.question} class="ask">
          <legend class="question">
            <InlineMarkdown text={q.question} />
          </legend>
          {q.multiSelect && <p class="ask-hint">Choose any that apply</p>}
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
                  <span class="tick" aria-hidden="true">
                    {on && <Check />}
                  </span>
                  <span class="option-text">
                    <span class="option-label">
                      <InlineMarkdown text={o.label} />
                    </span>
                    {o.description && (
                      <span class="option-desc">
                        <InlineMarkdown text={o.description} />
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
      <div class="actions">
        <button type="button" class="btn primary wide" disabled={!complete} onClick={send}>
          <Check />
          {complete ? 'Send answer' : questions.length > 1 ? 'Answer every question' : 'Pick an answer'}
        </button>
      </div>
    </>
  )
}

function PendingStatus({ id, pending }: { id: string; pending: Pending }) {
  if (pending.status === 'sending' || pending.status === 'sent') {
    return (
      <div class="note live" role="status">
        <span class="spinner" aria-hidden="true" />
        <p>{pending.status === 'sending' ? 'Sending…' : `${pending.label}. Waiting for your computer…`}</p>
      </div>
    )
  }
  if (pending.status === 'applied') {
    return (
      <div class="note ok" role="status">
        <Check />
        <p>{pending.label}</p>
      </div>
    )
  }
  return (
    <div class="note bad" role="alert">
      <Alert />
      <p>
        <strong>{pending.status === 'rejected' ? 'Not applied' : 'Couldn’t send'}</strong>
        {pending.detail && <span class="note-detail">{pending.detail}</span>}
      </p>
      <button type="button" class="btn quiet small" onClick={() => clearPending(id)}>
        OK
      </button>
    </div>
  )
}
