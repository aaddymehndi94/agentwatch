// Web Push subscription for this device. iOS only allows it from an installed (Home Screen) app.

import { fromB64u } from '@agentwatch/protocol/lite'
import { api } from './api.ts'

export type PushSupport = 'ok' | 'needs-install' | 'unsupported'

export function isIos(): boolean {
  return (
    /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

export function pushSupport(): PushSupport {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  if (!('PushManager' in window) || !('Notification' in window))
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported'
  return 'ok'
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker?.getRegistration()
  return (await reg?.pushManager.getSubscription()) ?? null
}

export async function enablePush(token: string): Promise<void> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this app. Allow them in your phone’s settings, then try again.'
        : 'Notifications weren’t allowed.',
    )
  }
  const reg = await navigator.serviceWorker.ready
  const { publicKey } = await api<{ publicKey: string }>(token, 'GET', '/api/push/vapid')
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    // Re-subscribe if the relay's VAPID key changed (e.g. a fresh relay).
    const current = sub.options.applicationServerKey
    const same = current && equalBytes(new Uint8Array(current), fromB64u(publicKey))
    if (!same) {
      await sub.unsubscribe()
      sub = null
    }
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: fromB64u(publicKey) as Uint8Array<ArrayBuffer>,
  })
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await api(token, 'POST', '/api/push/subscription', { endpoint: json.endpoint, keys: json.keys })
}

export async function disablePush(token: string): Promise<void> {
  const sub = await currentSubscription()
  if (!sub) return
  await api(token, 'DELETE', '/api/push/subscription', { endpoint: sub.endpoint }).catch(() => {})
  await sub.unsubscribe()
}

export async function testPush(token: string): Promise<{ sent: number; failed: number }> {
  return api(token, 'POST', '/api/push/test')
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}
