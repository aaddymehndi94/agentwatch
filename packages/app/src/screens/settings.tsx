// Settings: notifications, mute, machines, paired devices, appearance, and unpairing.

import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { api, type DeviceInfo } from '../lib/api.ts'
import { sourceLabel } from '../lib/model.ts'
import { currentSubscription, disablePush, enablePush, pushSupport, testPush } from '../lib/push.ts'
import { type AppState, forgetDevice, refresh, setMuteLocal, setTheme, type Theme } from '../lib/store.ts'
import { ago, clock } from '../lib/time.ts'
import { TopBar } from '../ui/bar.tsx'
import { Laptop, Phone } from '../ui/icons.tsx'

declare const __APP_VERSION__: string

export function SettingsScreen({ app, now, go }: { app: AppState; now: number; go: (hash: string) => void }) {
  return (
    <>
      <TopBar back={() => go('#/')} title="Settings" />
      <div class="page">
        <Notifications app={app} />
        <Mute app={app} now={now} />
        <Machines app={app} now={now} />
        <Devices app={app} now={now} />
        <Appearance app={app} />
        <Group title="This phone">
          <div class="item">
            <span class="item-main">
              <span class="label">Relay</span>
              <span class="hint mono">{location.host}</span>
            </span>
          </div>
          <div class="item">
            <span class="item-main">
              <span class="label">Unpair this phone</span>
              <span class="hint">Removes its key and stops notifications. You can pair again any time.</span>
            </span>
            <button
              type="button"
              class="btn quiet small danger"
              onClick={async () => {
                if (!confirm('Unpair this phone? It will stop receiving notifications.')) return
                await forgetDevice()
                go('#/pair')
              }}
            >
              Unpair
            </button>
          </div>
        </Group>
        <p class="fine center">AgentWatch {typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''}</p>
      </div>
    </>
  )
}

function Group(props: {
  title: string
  aside?: ComponentChildren
  foot?: ComponentChildren
  children: ComponentChildren
}) {
  return (
    <section class="sgroup">
      <div class="sgroup-head">
        <h2>{props.title}</h2>
        {props.aside && <span class="sgroup-aside">{props.aside}</span>}
      </div>
      <div class="list">{props.children}</div>
      {props.foot && <p class="fine">{props.foot}</p>}
    </section>
  )
}

/** A segmented control whose highlight slides to the chosen option. */
function Segmented<T>(props: {
  label: string
  options: { label: string; value: T }[]
  isOn: (v: T) => boolean
  set: (v: T) => void
}) {
  const index = props.options.findIndex((o) => props.isOn(o.value))
  return (
    <fieldset
      class="segmented"
      style={{ '--n': String(props.options.length), '--i': String(index) }}
      data-none={index < 0 ? '' : undefined}
    >
      <legend class="visually-hidden">{props.label}</legend>
      {props.options.map((o) => (
        <button type="button" key={o.label} aria-pressed={props.isOn(o.value)} onClick={() => props.set(o.value)}>
          {o.label}
        </button>
      ))}
    </fieldset>
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
    <Group title="Notifications">
      <div class="item">
        <span class="item-main">
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
            class={`btn small ${on ? 'quiet' : 'primary'}`}
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
          <span class="item-main">
            <span class="label">Test</span>
            <span class="hint">{msg || 'Send a notification to this phone now.'}</span>
          </span>
          <button
            type="button"
            class="btn quiet small"
            disabled={busy}
            onClick={() => run(() => testPush(token), 'Sent. It should arrive within a few seconds.')}
          >
            Send test
          </button>
        </div>
      )}
    </Group>
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
    <section class="sgroup">
      <div class="sgroup-head">
        <h2>Mute</h2>
        <span class="sgroup-aside">{mute ? `Until ${clock(mute)}` : 'Not muted'}</span>
      </div>
      <Segmented
        label="Mute notifications"
        options={options.map((o) => ({ label: o.label, value: o }))}
        isOn={(o) => (o.until === null ? mute === null : false)}
        set={(o) => void set(o.until)}
      />
      <p class="fine">Muting applies to every paired phone. The app still shows everything.</p>
    </section>
  )
}

function Machines({ app, now }: { app: AppState; now: number }) {
  const sources = app.model?.sources ?? []
  return (
    <Group title="Computers">
      {sources.length === 0 && (
        <div class="item">
          <span class="hint">
            None yet. Run <code>agentwatch setup</code> on a computer.
          </span>
        </div>
      )}
      {sources.map((s) => (
        <div class="item top" key={s.id}>
          <span class={`item-icon ${s.online ? 'on' : ''}`}>
            <Laptop />
          </span>
          <span class="item-main">
            <span class="label mono">{sourceLabel(s)}</span>
            <span class="hint">
              <span class={`dot ${s.online ? '' : 'off'}`} />
              {s.online ? 'Online' : `Offline · last seen ${ago(s.lastSeen, now)} ago`}
            </span>
            <span class="hint">
              {s.privacy === 'summary' ? 'Private: states only, no text leaves it' : 'Full text'}
              {s.allowMessages ? '' : ' · No replies'}
            </span>
            <span class="hint">
              {Object.values(s.adapters).join(', ') || 'No agents yet'}
              {s.daemonVersion ? ` · agentwatch ${s.daemonVersion}` : ''}
            </span>
          </span>
        </div>
      ))}
    </Group>
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
    <Group title="Paired phones">
      {devices.map((d) => (
        <div class="item" key={d.id}>
          <span class="item-icon">
            <Phone />
          </span>
          <span class="item-main">
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
              class="btn quiet small danger"
              onClick={async () => {
                const ask = `Remove ${d.name}? It is signed out at once. If it was lost or stolen, also run \`agentwatch rotate\` on your computer: the phone still holds the key.`
                if (!token || !confirm(ask)) return
                await api(token, 'DELETE', `/api/devices/${d.id}`).catch(() => {})
                load()
              }}
            >
              Remove
            </button>
          )}
        </div>
      ))}
    </Group>
  )
}

function Appearance({ app }: { app: AppState }) {
  const options: { label: string; value: Theme }[] = [
    { label: 'System', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ]
  return (
    <section class="sgroup">
      <div class="sgroup-head">
        <h2>Appearance</h2>
      </div>
      <Segmented label="Theme" options={options} isOn={(v) => app.theme === v} set={(v) => void setTheme(v)} />
    </section>
  )
}
