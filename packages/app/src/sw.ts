/// <reference lib="webworker" />
// Service worker: shows pushes (decrypting them on the phone), handles Approve/Deny from the notification on Android,
// and keeps the app shell available offline. Built separately into /sw.js (see vite.config.ts).

import type { PushInfo, PushPayload } from '@agentwatch/protocol'
import { bind, buildCommand, fromB64u, open } from '@agentwatch/protocol/lite'
import { kv, loadCredentials } from './lib/db.ts'
import { vaultKey } from './lib/model.ts'

declare const self: ServiceWorkerGlobalScope

const SHELL = 'shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['/', '/manifest.webmanifest']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== SHELL) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return
  if (req.mode === 'navigate') {
    // Network first so updates land; the cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          void caches.open(SHELL).then((c) => c.put('/', copy))
          return res
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    )
    return
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    // Hashed or static: cache first.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              void caches.open(SHELL).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})

/** Defensive parse of a push payload (the relay is trusted for routing only, never for content). */
function parsePayload(data: PushMessageData | null): PushPayload {
  const fallback: PushPayload = { v: 1, tag: 'agentwatch', kind: 'test' }
  let raw: Record<string, unknown>
  try {
    raw = data?.json() ?? {}
  } catch {
    return fallback
  }
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : undefined)
  const kind = str('kind')
  return {
    v: 1,
    tag: str('tag')?.slice(0, 200) ?? 'agentwatch',
    kind: kind === 'needs_you' || kind === 'done' || kind === 'offline' || kind === 'test' ? kind : 'test',
    sourceId: str('sourceId'),
    sessionId: str('sessionId'),
    requestId: str('requestId'),
    actions: raw.actions === true,
    sealed: str('sealed'),
    title: str('title')?.slice(0, 200),
    body: str('body')?.slice(0, 1000),
  }
}

// ── Push ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function describe(p: PushPayload): Promise<PushInfo> {
  if (p.title && p.body !== undefined) return { title: p.title, body: p.body }
  const generic: PushInfo = {
    title: p.kind === 'needs_you' ? 'An agent needs you' : p.kind === 'done' ? 'An agent finished' : 'AgentWatch',
    body: 'Open AgentWatch to see details.',
  }
  if (!p.sealed || !p.sourceId) return generic
  try {
    const creds = await loadCredentials()
    if (!creds) return generic
    const info = await open<PushInfo>(await vaultKey(creds.vaultKey), p.sealed, bind.push(p.sourceId, p.tag))
    if (typeof info?.title !== 'string' || typeof info.body !== 'string') return generic
    return { title: info.title.slice(0, 200), body: info.body.slice(0, 1000) }
  } catch {
    return generic
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const payload = parsePayload(event.data)
      const info = await describe(payload)
      const options: NotificationOptions & { renotify?: boolean; actions?: { action: string; title: string }[] } = {
        body: info.body,
        tag: payload.tag,
        renotify: true,
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        data: payload,
        requireInteraction: payload.kind === 'needs_you',
      }
      if (payload.actions && payload.requestId) {
        options.actions = [
          { action: 'deny', title: 'Deny' },
          { action: 'approve', title: 'Approve' },
        ]
      }
      await self.registration.showNotification(info.title, options)
      for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ t: 'refresh' })
    })(),
  )
})

self.addEventListener('notificationclick', (event) => {
  const n = event.notification
  const p = n.data as PushPayload | undefined
  n.close()
  if (p && (event.action === 'approve' || event.action === 'deny') && p.sourceId && p.sessionId && p.requestId) {
    event.waitUntil(decideFromNotification(p, event.action === 'approve' ? 'allow' : 'deny', n.title))
    return
  }
  const target =
    p?.sourceId && p.sessionId ? `/#/s/${encodeURIComponent(p.sourceId)}/${encodeURIComponent(p.sessionId)}` : '/'
  event.waitUntil(openApp(target))
})

async function openApp(target: string): Promise<void> {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const w of wins) {
    if ('focus' in w) {
      await (w as WindowClient).focus()
      await (w as WindowClient).navigate(target).catch(() => {})
      return
    }
  }
  await self.clients.openWindow(target)
}

async function decideFromNotification(p: PushPayload, behavior: 'allow' | 'deny', title: string): Promise<void> {
  const verb = behavior === 'allow' ? 'Approved' : 'Denied'
  const fail = (why: string) =>
    self.registration.showNotification(`Couldn’t ${behavior === 'allow' ? 'approve' : 'deny'}`, {
      body: `${why} Tap to open AgentWatch.`,
      tag: p.tag,
      data: { ...p, actions: false },
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
    })
  try {
    const creds = await loadCredentials()
    if (!creds) return fail('This phone isn’t paired.')
    const env = await buildCommand(await vaultKey(creds.vaultKey), {
      deviceId: creds.deviceId,
      sourceId: p.sourceId!,
      sessionId: p.sessionId!,
      requestId: p.requestId!,
      body: { kind: 'decide', behavior },
    })
    const auth = { authorization: `Bearer ${creds.token}` }
    const res = await fetch('/api/commands', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(env),
    })
    if (!res.ok) return fail('The relay refused it.')
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const c = (await fetch(`/api/commands/${env.commandId}`, { headers: auth }).then((r) => r.json())) as {
        status: string
        detail?: string
      }
      if (c.status === 'applied') {
        await self.registration.showNotification(verb, {
          body: title,
          tag: p.tag,
          silent: true,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
        })
        setTimeout(async () => {
          for (const n of await self.registration.getNotifications({ tag: p.tag })) n.close()
        }, 4000)
        return
      }
      if (c.status === 'rejected' || c.status === 'expired') return fail(c.detail ? `${c.detail}.` : 'It was rejected.')
    }
    await fail('Your computer didn’t answer in time.')
  } catch {
    await fail('Something went wrong.')
  } finally {
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ t: 'refresh' })
  }
}

self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { waitUntil: (p: Promise<unknown>) => void }
  e.waitUntil(
    (async () => {
      const creds = await loadCredentials()
      if (!creds) return
      const { publicKey } = (await fetch('/api/push/vapid', {
        headers: { authorization: `Bearer ${creds.token}` },
      }).then((r) => r.json())) as { publicKey: string }
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromB64u(publicKey) as Uint8Array<ArrayBuffer>,
      })
      await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { authorization: `Bearer ${creds.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      await kv.set('resubscribedAt', Date.now())
    })(),
  )
})
