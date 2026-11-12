// Pairing: claim the one-time code from `agentwatch pair`, then turn on notifications and send a test.
// iPhone: push only works from the Home Screen app, which has its own storage, so pair *inside* the installed app.

import type { ComponentChildren } from 'preact'
import { useState } from 'preact/hooks'
import { enablePush, isIos, isStandalone, pushSupport, testPush } from '../lib/push.ts'
import { type AppState, pairWithCode } from '../lib/store.ts'
import { Check, Copy } from '../ui/icons.tsx'

function defaultName(): string {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  return 'Browser'
}

export function PairScreen({ app, code: initial, go }: { app: AppState; code?: string; go: (hash: string) => void }) {
  if (app.creds && !app.revoked) return <Notifications app={app} go={go} />
  if (initial && isIos() && !isStandalone()) return <InstallFirst code={initial} />
  return <Claim initial={initial} />
}

function Claim({ initial }: { initial?: string }) {
  const [code, setCode] = useState(initial ?? '')
  const [name, setName] = useState(defaultName())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ComponentChildren>(null)
  const submit = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await pairWithCode(code, name.trim() || defaultName())
      history.replaceState(null, '', '#/pair')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        /expired|used/i.test(msg) ? (
          <>
            That code has expired or was already used. Run <code>agentwatch pair</code> again for a new one.
          </>
        ) : /pairing code/i.test(msg) ? (
          <>
            That doesn’t look like a pairing code. Copy the whole code that <code>agentwatch pair</code> shows.
          </>
        ) : (
          msg
        ),
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="page">
      <h1 class="hero-title">{initial ? 'Pair this phone' : 'Connect to your agents'}</h1>
      <p class="lede">
        {initial ? (
          `Your computer created a one-time code for ${location.host}. Pairing gives this phone the key to read your agents’ activity and answer them.`
        ) : (
          <>
            On your computer, run <code>agentwatch pair</code> and scan the QR code with this phone. Or paste the code
            it shows here.
          </>
        )}
      </p>
      <form onSubmit={submit}>
        {!initial && (
          <div class="field">
            <label for="code">Pairing code</label>
            <input
              id="code"
              autoComplete="off"
              autoCapitalize="off"
              spellcheck={false}
              value={code}
              onInput={(e) => setCode((e.target as HTMLInputElement).value)}
              placeholder="xxxxxxxx.xxxxxxxxxxxxxxxx"
            />
          </div>
        )}
        <div class="field">
          <label for="name">Name for this phone</label>
          <input id="name" value={name} maxLength={60} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </div>
        {error && (
          <p class="error-text" role="alert">
            {error}
          </p>
        )}
        <button type="submit" class="btn primary block" disabled={busy || !code.trim()}>
          {busy ? <span class="spinner" aria-hidden="true" /> : <Check />}
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </form>
      <p class="fine">
        The code works once and expires after 10 minutes. Your relay never sees the key, only the encrypted data.
      </p>
    </div>
  )
}

function InstallFirst({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div class="page">
      <h1 class="hero-title">Add AgentWatch to your Home Screen first</h1>
      <p class="lede">
        iPhone only sends notifications to apps on the Home Screen, and that app keeps its own storage.
      </p>
      <ol class="steps">
        <li>
          <span>
            Copy this pairing code. It works once, for 10 minutes.
            <span class="code-box" style={{ marginTop: 8, marginBottom: 0 }}>
              <span>{code}</span>
              <button
                type="button"
                class="btn quiet"
                onClick={async () => {
                  await navigator.clipboard.writeText(code).catch(() => {})
                  setCopied(true)
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </span>
          </span>
        </li>
        <li>Tap the Share button in Safari, then “Add to Home Screen”.</li>
        <li>Open AgentWatch from your Home Screen and paste the code.</li>
      </ol>
    </div>
  )
}

function Notifications({ app, go }: { app: AppState; go: (hash: string) => void }) {
  const support = pushSupport()
  const [step, setStep] = useState<'ask' | 'enabled' | 'tested'>('ask')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const token = app.creds?.token ?? ''
  const enable = async () => {
    setBusy(true)
    setError('')
    try {
      await enablePush(token)
      setStep('enabled')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const test = async () => {
    setBusy(true)
    setError('')
    try {
      const r = await testPush(token)
      if (r.sent < 1) throw new Error('The relay couldn’t deliver to this phone. Try turning notifications off and on.')
      setStep('tested')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div class="page">
      <h1 class="hero-title">
        <Check /> Paired
      </h1>
      {support === 'ok' ? (
        <>
          <p class="lede">
            Turn on notifications to hear when an agent needs you or finishes a long task. On Android you can approve
            straight from the notification.
          </p>
          {error && (
            <p class="error-text" role="alert">
              {error}
            </p>
          )}
          {step === 'ask' && (
            <button type="button" class="btn primary block" disabled={busy} onClick={enable}>
              {busy && <span class="spinner" aria-hidden="true" />}
              Turn on notifications
            </button>
          )}
          {step === 'enabled' && (
            <button type="button" class="btn primary block" disabled={busy} onClick={test}>
              {busy && <span class="spinner" aria-hidden="true" />}
              Send a test notification
            </button>
          )}
          {step === 'tested' && <p class="ok-text">Sent. It should arrive within a few seconds.</p>}
        </>
      ) : (
        <p class="lede">
          {support === 'needs-install'
            ? 'To get notifications on iPhone, add AgentWatch to your Home Screen and pair from there.'
            : 'This browser can’t receive push notifications. The app still works. Open it to check on your agents.'}
        </p>
      )}
      <button type="button" class="btn quiet block" style={{ marginTop: 12 }} onClick={() => go('#/')}>
        {step === 'ask' && support === 'ok' ? 'Skip for now' : 'Go to inbox'}
      </button>
    </div>
  )
}

/** A `#/join/…` invite is for a computer (`agentwatch join`), not a phone. Say so instead of a confusing pair form. */
export function JoinOnPhone() {
  return (
    <div class="page">
      <h1 class="hero-title">This invite is for a computer</h1>
      <p class="lede">
        It adds another computer or OS user to your relay. On that computer, run <code>agentwatch join</code> and paste
        the whole link when it asks.
      </p>
      <p class="fine">
        To pair a phone instead, run <code>agentwatch pair</code> on a computer that is already set up.
      </p>
    </div>
  )
}
