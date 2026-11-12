// Web Push from the Hub (RFC 8291 aes128gcm + RFC 8292 VAPID) via @block65/webcrypto-web-push.
// VAPID keys are generated inside the Durable Object on first use, so a fresh deploy needs no push secrets.

import { type PushPayload, sha256Hex, toB64u } from '@agentwatch/protocol'
import { buildPushPayload } from '@block65/webcrypto-web-push'

export type PushSubscriptionRow = {
  endpoint: string
  device_id: string
  p256dh: string
  auth: string
}

interface Vapid {
  publicKey: string
  privateKey: string
}

export async function ensureVapid(sql: SqlStorage): Promise<Vapid> {
  const row = sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'vapid'`).toArray()[0]
  if (row) return JSON.parse(row.v) as Vapid
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer)
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey
  const vapid: Vapid = { publicKey: toB64u(raw), privateKey: jwk.d! }
  sql.exec(`INSERT INTO meta (k, v) VALUES ('vapid', ?)`, JSON.stringify(vapid))
  return vapid
}

/** RFC 8030 Topic: ≤ 32 URL-safe base64 chars. A newer push with the same topic replaces an undelivered older one. */
async function topicFor(tag: string): Promise<string> {
  return (await sha256Hex(tag)).slice(0, 32)
}

export interface DeliveryResult {
  sent: number
  failed: number
  pruned: number
}

export async function deliverPush(
  sql: SqlStorage,
  env: Env,
  payload: PushPayload,
  urgency: 'high' | 'normal',
  only?: PushSubscriptionRow[],
): Promise<DeliveryResult> {
  const subs =
    only ?? sql.exec<PushSubscriptionRow>('SELECT endpoint, device_id, p256dh, auth FROM push_subs').toArray()
  const result: DeliveryResult = { sent: 0, failed: 0, pruned: 0 }
  if (!subs.length) return result
  const vapid = await ensureVapid(sql)
  const subject = env.VAPID_SUBJECT || originSubject(sql)
  const topic = await topicFor(payload.tag)
  await Promise.all(
    subs.map(async (s) => {
      try {
        // Tests only: a local fake push service on plain http. The library insists on https, so sign for that form.
        const insecure = env.ALLOW_INSECURE_PUSH === '1' && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(s.endpoint)
        const req = await buildPushPayload(
          { data: payload, options: { ttl: urgency === 'high' ? 3 * 3600 : 3600, urgency, topic } },
          {
            endpoint: insecure ? s.endpoint.replace(/^http:/, 'https:') : s.endpoint,
            expirationTime: null,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          { subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        )
        const res = await fetch(s.endpoint, req)
        if (res.status === 404 || res.status === 410) {
          sql.exec('DELETE FROM push_subs WHERE endpoint = ?', s.endpoint)
          result.pruned++
        } else if (res.ok) {
          result.sent++
        } else {
          result.failed++
          console.warn('push failed', res.status, (await res.text()).slice(0, 200))
        }
      } catch (e) {
        result.failed++
        console.warn('push error', e)
      }
    }),
  )
  return result
}

/** VAPID `sub` must be an https URL or mailto:. Default to the relay's own origin, remembered from requests. */
function originSubject(sql: SqlStorage): string {
  const row = sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'origin'`).toArray()[0]
  return row?.v ?? 'https://example.com'
}

export function rememberOrigin(sql: SqlStorage, url: URL): void {
  if (url.protocol !== 'https:') return
  sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('origin', ?)`, url.origin)
}
