// App state: credentials, the decrypted model, in-flight commands. A tiny observable store plus a Preact hook.

import type { CommandBody, StateView } from '@agentwatch/protocol'
import { buildCommand, importVaultKey, parsePairingCode, unwrapVaultKey } from '@agentwatch/protocol/lite'
import { useEffect, useState } from 'preact/hooks'
import { ApiError, api, getState } from './api.ts'
import { type Credentials, kv, loadCredentials, saveCredentials } from './db.ts'
import { type DemoVariant, demoModel } from './demo.ts'
import { decryptState, type Model, vaultKey } from './model.ts'

export type Theme = 'system' | 'light' | 'dark'

export interface Pending {
  commandId: string
  label: string
  status: 'sending' | 'sent' | 'applied' | 'rejected' | 'failed'
  detail?: string
  at: number
}

export interface AppState {
  booted: boolean
  demo: boolean
  creds: Credentials | null
  model: Model | null
  /** Last refresh problem, shown as a quiet banner over stale data. */
  error: string | null
  lastSync: number | null
  /** Keyed by request id (decisions/answers) or session key (messages). */
  pending: Record<string, Pending>
  theme: Theme
  /** Set when the relay says this device's token is gone. */
  revoked: boolean
}

let state: AppState = {
  booted: false,
  demo: false,
  creds: null,
  model: null,
  error: null,
  lastSync: null,
  pending: {},
  theme: 'system',
  revoked: false,
}
const listeners = new Set<() => void>()

function set(patch: Partial<AppState>): void {
  state = { ...state, ...patch }
  for (const l of listeners) l()
}

export function getAppState(): AppState {
  return state
}

export function useApp(): AppState {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return state
}

// ── Boot and sync ────────────────────────────────────────────────────────────────────────────────────────────────

const POLL_MS = 10_000
const FAST_POLL_MS = 2_000
let timer: ReturnType<typeof setTimeout> | null = null

export async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search)
  const demo = params.has('demo')
  const themeParam = params.get('theme')
  const theme = (themeParam ?? (await kv.get<Theme>('theme').catch(() => undefined)) ?? 'system') as Theme
  applyTheme(theme)
  if (demo) {
    const variant = (params.get('demo') || 'full') as DemoVariant
    const offline = variant === 'offline'
    set({
      booted: true,
      demo: true,
      theme,
      model: demoModel(Date.now(), variant),
      lastSync: Date.now() - (offline ? 6 * 60_000 : 0),
      error: offline ? 'Can’t reach your relay. Check your connection.' : null,
    })
    return
  }
  const creds = (await loadCredentials().catch(() => undefined)) ?? null
  let model: Model | null = null
  if (creds) {
    const cached = await kv.get<StateView>('state').catch(() => undefined)
    if (cached) model = await decryptState(cached, await vaultKey(creds.vaultKey)).catch(() => null)
  }
  set({ booted: true, creds, model, theme })
  if (creds) void refresh()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  })
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if ((e.data as { t?: string })?.t === 'refresh') void refresh()
  })
}

// Refreshes overlap (poll, send, visibility, the service worker): only the newest one may write the model.
let refreshSeq = 0
let appliedSeq = 0

export async function refresh(): Promise<void> {
  if (timer) clearTimeout(timer)
  timer = null
  const creds = state.creds
  if (!creds || state.demo) return
  const seq = ++refreshSeq
  try {
    const raw = await getState(creds.token)
    const model = await decryptState(raw, await vaultKey(creds.vaultKey))
    if (seq < appliedSeq) return
    appliedSeq = seq
    await kv.set('state', raw).catch(() => {})
    set({ model, error: null, lastSync: Date.now(), revoked: false })
    settlePending(model)
    void closeAnsweredNotifications(model)
  } catch (e) {
    if (seq < appliedSeq) return
    if (e instanceof ApiError && e.status === 401) set({ revoked: true, error: e.message })
    else set({ error: e instanceof Error ? e.message : String(e) })
  }
  schedule()
}

/** A "needs you" notification for a request that was answered elsewhere (or timed out) shouldn't linger. */
async function closeAnsweredNotifications(model: Model): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (!reg) return
    const open = new Set(model.requests.filter((r) => r.status === 'open').map((r) => `req:${r.id}`))
    for (const n of await reg.getNotifications()) if (n.tag.startsWith('req:') && !open.has(n.tag)) n.close()
  } catch {}
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (document.visibilityState !== 'visible') return
  const busy = Object.values(state.pending).some((p) => p.status === 'sending' || p.status === 'sent')
  timer = setTimeout(() => void refresh(), busy ? FAST_POLL_MS : POLL_MS)
}

/** Drop pending markers whose request has closed, and old results. */
function settlePending(model: Model): void {
  const next: Record<string, Pending> = {}
  const now = Date.now()
  for (const [k, p] of Object.entries(state.pending)) {
    const req = model.requests.find((r) => r.id === k)
    if (req && req.status !== 'open' && p.status !== 'rejected' && p.status !== 'failed') continue
    if (now - p.at > 60_000 && p.status !== 'sending') continue
    next[k] = p
  }
  set({ pending: next })
}

// ── Commands ─────────────────────────────────────────────────────────────────────────────────────────────────────

export async function sendCommand(args: {
  key: string
  label: string
  sourceId: string
  sessionId: string
  requestId?: string
  body: CommandBody
}): Promise<boolean> {
  const creds = state.creds
  const mark = (p: Partial<Pending>) =>
    set({ pending: { ...state.pending, [args.key]: { ...(state.pending[args.key] as Pending), ...p } } })
  set({
    pending: { ...state.pending, [args.key]: { commandId: '', label: args.label, status: 'sending', at: Date.now() } },
  })
  if (state.demo) {
    setTimeout(() => {
      mark({ status: 'applied' })
      const m = state.model
      if (m && args.requestId) {
        set({
          model: {
            ...m,
            requests: m.requests.map((r) =>
              r.id === args.requestId ? { ...r, status: 'answered', closedAt: Date.now() } : r,
            ),
            sessions: m.sessions.map((s) =>
              s.id === args.sessionId ? { ...s, state: 'working', stateSince: Date.now() } : s,
            ),
          },
        })
      }
    }, 700)
    return true
  }
  if (!creds) return false
  try {
    const env = await buildCommand(await vaultKey(creds.vaultKey), {
      deviceId: creds.deviceId,
      sourceId: args.sourceId,
      sessionId: args.sessionId,
      requestId: args.requestId,
      body: args.body,
    })
    await api(creds.token, 'POST', '/api/commands', env)
    mark({ commandId: env.commandId, status: 'sent' })
    void watchCommand(args.key, env.commandId)
    void refresh()
    return true
  } catch (e) {
    mark({ status: 'failed', detail: e instanceof Error ? e.message : String(e) })
    return false
  }
}

async function watchCommand(key: string, commandId: string): Promise<void> {
  const creds = state.creds
  if (!creds) return
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 1200))
    try {
      const c = await api<{ status: string; detail?: string }>(creds.token, 'GET', `/api/commands/${commandId}`)
      if (c.status === 'applied' || c.status === 'rejected' || c.status === 'expired') {
        const p = state.pending[key]
        if (p?.commandId === commandId) {
          set({
            pending: {
              ...state.pending,
              [key]: {
                ...p,
                status: c.status === 'applied' ? 'applied' : 'rejected',
                detail: c.detail,
                at: Date.now(),
              },
            },
          })
        }
        void refresh()
        return
      }
    } catch {}
  }
  const p = state.pending[key]
  if (p?.commandId === commandId && p.status === 'sent') {
    set({
      pending: {
        ...state.pending,
        [key]: { ...p, status: 'failed', detail: 'Your computer hasn’t picked this up yet. It may be offline.' },
      },
    })
  }
}

export function clearPending(key: string): void {
  const { [key]: _, ...rest } = state.pending
  set({ pending: rest })
}

// ── Pairing ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function pairWithCode(code: string, name: string): Promise<void> {
  const secret = parsePairingCode(code.trim().replace(/^.*#\/pair\//, ''))
  const res = await api<{ kind: string; deviceId: string; deviceToken: string; wrapped: string }>(
    null,
    'POST',
    '/api/pair/claim',
    { pairId: secret.pairId, name },
  )
  if (res.kind !== 'device') throw new Error('That code is for adding a computer, not a phone.')
  const raw = await unwrapVaultKey(res.wrapped, secret)
  await importVaultKey(raw) // validate before saving
  const creds: Credentials = {
    deviceId: res.deviceId,
    token: res.deviceToken,
    vaultKey: raw,
    name,
    pairedAt: Date.now(),
  }
  await saveCredentials(creds)
  set({ creds, revoked: false, error: null })
  await refresh()
}

export async function forgetDevice(): Promise<void> {
  const creds = state.creds
  if (creds) await api(creds.token, 'DELETE', `/api/devices/${creds.deviceId}`).catch(() => {})
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    await sub?.unsubscribe()
  } catch {}
  await kv.clear()
  set({ creds: null, model: null, pending: {}, revoked: false, error: null })
}

// ── Theme ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#05060a' : '#f2f3f7')
}

export async function setTheme(theme: Theme): Promise<void> {
  applyTheme(theme)
  set({ theme })
  await kv.set('theme', theme).catch(() => {})
}

export function setMuteLocal(mute: number | null): void {
  if (state.model) set({ model: { ...state.model, mute } })
}
