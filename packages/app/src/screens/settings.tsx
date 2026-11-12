// Settings: notifications, mute, machines, paired devices, appearance, and unpairing.

import { useEffect, useState } from 'preact/hooks'
import { api, type DeviceInfo } from '../lib/api.ts'
import { sourceLabel } from '../lib/model.ts'
import { currentSubscription, disablePush, enablePush, pushSupport, testPush } from '../lib/push.ts'
import { type AppState, forgetDevice, refresh, setMuteLocal, setTheme, type Theme } from '../lib/store.ts'
import { ago, clock } from '../lib/time.ts'
import { Back } from '../ui/icons.tsx'

declare const __APP_VERSION__: string

export function SettingsScreen({ app, now, go }: { app: AppState; now: number; go: (hash: string) => void }) {
  return (
    <>
      <header class="topbar">
        <button type="button" class="icon-btn" onClick={() => go('#/')} aria-label="Back to inbox">
          <Back />
        </button>
        <h1>
          <span class="title-text">Settings</span>
        </h1>
      </header>
      <div class="page">
        <Notifications app={app} />
        <Mute app={app} now={now} />
        <Machines app={app} now={now} />
        <Devices app={app} now={now} />
        <Appearance app={app} />
        <div class="section-head" style={{ padding: 0 }}>
          <h2>This phone</h2>
        </div>
        <div class="panel">
          <div class="item">
            <span class="grow">
              <span class="label">Relay</span>
              <span class="hint mono">{location.host}</span>
            </span>
          </div>
          <div class="item">
            <span class="grow">
              <span class="label">Unpair this phone</span>
              <span class="hint">Removes its key and stops notifications. You can pair again any time.</span>
            </span>
            <button
              type="button"
              class="btn quiet"
              onClick={async () => {
                if (!confirm('Unpair this phone? It will stop receiving notifications.')) return
                await forgetDevice()
                go('#/pair')
              }}
            >
              Unpair
            </button>
          </div>
        </div>
        <p class="fine">AgentWatch {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}</p>
      </div>
    </>
  )
}

function Notifications({ app }: { app: AppState }) {
  const support = pushSupport()
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const token = app.creds?.token ?? ''
  useEffect(() => {
    void currentSubscription().then((s) => setOn(!!s))
  }, [])
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    setMsg('')
    try {
      await fn()
      if (done) setMsg(done)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div class="section-head" style={{ padding: 0 }}>
        <h2>Notifications</h2>
      </div>
      <div class="panel">
        <div class="item">
          <span class="grow">
            <span class="label">Push notifications</span>
            <span class="hint">
              {support === 'ok'
                ? on
                  ? 'On for this phone.'
                  : 'Off for this phone.'
                : support === 'needs-install'
                  ? 'Add AgentWatch to your Home Screen to get notifications.'
                  : 'Not supported in this browser.'}
            </span>
          </span>
          {support === 'ok' && on !== null && (
            <button
              type="button"
              class={`btn ${on ? 'quiet' : 'primary'}`}
              disabled={busy || app.demo}
              onClick={() =>
                run(async () => {
                  if (on) await disablePush(token)
                  else await enablePush(token)
                  setOn(!on)
                })
              }
            >
              {on ? 'Turn off' : 'Turn on'}
            </button>
          )}
        </div>
        {support === 'ok' && on && (
          <div class="item">
            <span class="grow">
              <span class="label">Test</span>
              <span class="hint">{msg || 'Send a notification to this phone now.'}</span>
            </span>
            <button
              type="button"
              class="btn quiet"
              disabled={busy}
              onClick={() => run(() => testPush(token), 'Sent. It should arrive within a few seconds.')}
            >
              Send test
            </button>
          </div>
        )}
      </div>
    </>
  )
}

function nextMorning(now: number): number {
  const d = new Date(now)
  d.setHours(8, 0, 0, 0)
  if (d.getTime() <= now) d.setDate(d.getDate() + 1)
  return d.getTime()
}

function Mute({ app, now }: { app: AppState; now: number }) {
  const mute = app.model?.mute ?? null
  const options: { label: string; until: number | null }[] = [
    { label: 'Off', until: null },
    { label: '1 h', until: now + 3600_000 },
    { label: '8 h', until: now + 8 * 3600_000 },
    { label: '8 am', until: nextMorning(now) },
  ]
  const set = async (until: number | null) => {
    setMuteLocal(until)
    if (app.creds && !app.demo) {
      await api(app.creds.token, 'POST', '/api/mute', { until }).catch(() => {})
      void refresh()
    }
  }
  return (
    <>
      <div class="section-head" style={{ padding: 0 }}>
        <h2>Mute</h2>
        <span class="hint" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          {mute ? `Until ${clock(mute)}` : 'Not muted'}
        </span>
      </div>
      <fieldset class="segmented">
        <legend class="visually-hidden">Mute notifications</legend>
        {options.map((o) => (
          <button
            type="button"
            key={o.label}
            aria-pressed={o.until === null ? mute === null : false}
            onClick={() => set(o.until)}
          >
            {o.label}
          </button>
        ))}
      </fieldset>
      <p class="fine" style={{ marginTop: 6 }}>
        Muting applies to every paired phone. The app still shows everything.
      </p>
    </>
  )
}

function Machines({ app, now }: { app: AppState; now: number }) {
  const sources = app.model?.sources ?? []
  return (
    <>
      <div class="section-head" style={{ padding: 0 }}>
        <h2>Computers</h2>
      </div>
      <div class="panel">
        {sources.length === 0 && (
          <div class="item">
            <span class="hint">
              None yet. Run <code>agentwatch setup</code> on a computer.
            </span>
          </div>
        )}
        {sources.map((s) => (
          <div class="item top" key={s.id}>
            <span class={`dot ${s.online ? '' : 'off'}`} />
            <span class="grow">
              <span class="label mono">{sourceLabel(s)}</span>
              <span class="hint">{s.online ? 'Online' : `Offline · last seen ${ago(s.lastSeen, now)} ago`}</span>
              <span class="hint">
                {s.privacy === 'summary' ? 'Summary privacy: no text leaves it' : 'Full detail'}
                {s.allowMessages ? '' : ' · No replies'}
              </span>
              <span class="hint">
                {Object.values(s.adapters).join(', ') || 'No agents yet'}
                {s.daemonVersion ? ` · agentwatch ${s.daemonVersion}` : ''}
              </span>
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function Devices({ app, now }: { app: AppState; now: number }) {
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null)
  const token = app.creds?.token
  const load = () => {
    if (!token || app.demo) return setDevices([])
    void api<DeviceInfo[]>(token, 'GET', '/api/devices')
      .then(setDevices)
      .catch(() => setDevices([]))
  }
  useEffect(load, [token])
  if (!devices || devices.length === 0) return null
  return (
    <>
      <div class="section-head" style={{ padding: 0 }}>
        <h2>Paired phones</h2>
      </div>
      <div class="panel">
        {devices.map((d) => (
          <div class="item" key={d.id}>
            <span class="grow">
              <span class="label">{d.name}</span>
              <span class="hint">
                Paired {new Date(d.createdAt).toLocaleDateString()} · active {ago(d.lastSeen, now)} ago
              </span>
            </span>
            {d.self ? (
              <span class="tag">This phone</span>
            ) : (
              <button
                type="button"
                class="btn quiet"
                onClick={async () => {
                  if (!token || !confirm(`Remove ${d.name}? It will stop receiving notifications.`)) return
                  await api(token, 'DELETE', `/api/devices/${d.id}`).catch(() => {})
                  load()
                }}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function Appearance({ app }: { app: AppState }) {
  const options: { label: string; value: Theme }[] = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ]
  return (
    <>
      <div class="section-head" style={{ padding: 0 }}>
        <h2>Appearance</h2>
      </div>
      <fieldset class="segmented">
        <legend class="visually-hidden">Theme</legend>
        {options.map((o) => (
          <button type="button" key={o.value} aria-pressed={app.theme === o.value} onClick={() => setTheme(o.value)}>
            {o.label}
          </button>
        ))}
      </fieldset>
    </>
  )
}
