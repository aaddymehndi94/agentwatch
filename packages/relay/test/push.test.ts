// S4: what the Hub sends must decrypt with an independent RFC 8291 receiver (written here on node:crypto), and carry
// valid RFC 8292 VAPID auth. This is the reference check for @block65/webcrypto-web-push.

import crypto from 'node:crypto'
import { buildPushPayload } from '@block65/webcrypto-web-push'
import { describe, expect, it } from 'vitest'

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url')
const hmac = (key: Uint8Array, data: Uint8Array) => crypto.createHmac('sha256', key).update(data).digest()

/** RFC 8291 + RFC 8188 (aes128gcm) decryption, as a browser push service client would do it. */
function decrypt(body: Uint8Array, uaPrivate: crypto.ECDH, auth: Uint8Array): string {
  const salt = body.subarray(0, 16)
  const rs = Buffer.from(body.subarray(16, 20)).readUInt32BE(0)
  const idlen = body[20]!
  const asPublic = body.subarray(21, 21 + idlen)
  const records = body.subarray(21 + idlen)
  expect(rs).toBeGreaterThanOrEqual(18)
  expect(records.length).toBeLessThanOrEqual(rs)
  const uaPublic = uaPrivate.getPublicKey()
  const ecdhSecret = uaPrivate.computeSecret(asPublic)
  const prkKey = hmac(auth, ecdhSecret)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])])
  const ikm = hmac(prkKey, keyInfo)
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(records.subarray(records.length - 16))
  const plain = Buffer.concat([d.update(records.subarray(0, records.length - 16)), d.final()])
  let end = plain.length
  while (end > 0 && plain[end - 1] === 0) end--
  expect(plain[end - 1]).toBe(2) // last-record delimiter
  return plain.subarray(0, end - 1).toString('utf8')
}

describe('Web Push payloads (RFC 8291 / 8292)', () => {
  it('decrypt with a reference receiver and carry a valid VAPID JWT', async () => {
    // The subscriber (browser) side.
    const ua = crypto.createECDH('prime256v1')
    ua.generateKeys()
    const auth = crypto.randomBytes(16)
    // The relay's VAPID keys, made the way ensureVapid makes them.
    const vapidPair = (await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const vapidPublic = new Uint8Array(await crypto.webcrypto.subtle.exportKey('raw', vapidPair.publicKey))
    const vapidJwk = await crypto.webcrypto.subtle.exportKey('jwk', vapidPair.privateKey)

    const payload = { v: 1, tag: 'req:abc', kind: 'needs_you', sourceId: 's', sessionId: 'x', sealed: 'A'.repeat(600) }
    const endpoint = 'https://push.example.net/send/abc123'
    const req = await buildPushPayload(
      { data: payload, options: { ttl: 10800, urgency: 'high', topic: 'a'.repeat(32) } },
      { endpoint, expirationTime: null, keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) } },
      { subject: 'https://relay.example.com', publicKey: b64u(vapidPublic), privateKey: vapidJwk.d! },
    )

    const headers = new Headers(req.headers as HeadersInit)
    expect(headers.get('content-encoding')).toBe('aes128gcm')
    expect(headers.get('ttl')).toBe('10800')
    expect(headers.get('urgency')).toBe('high')
    expect(headers.get('topic')).toBe('a'.repeat(32))
    const body = new Uint8Array(await new Response(req.body as BodyInit).arrayBuffer())
    // A push service caps payloads at 4096 bytes.
    expect(body.length).toBeLessThanOrEqual(4096)
    expect(JSON.parse(decrypt(body, ua, auth))).toEqual(payload)

    // VAPID: Authorization: vapid t=<JWT>, k=<public key>
    const m = /^vapid t=([^,]+),\s*k=(.+)$/.exec(headers.get('authorization') ?? '')
    expect(m).not.toBeNull()
    const [, jwt, k] = m!
    expect(k).toBe(b64u(vapidPublic))
    const [h, c, sig] = jwt!.split('.')
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toMatchObject({ alg: 'ES256', typ: 'JWT' })
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString())
    expect(claims.aud).toBe('https://push.example.net')
    expect(claims.sub).toBe('https://relay.example.com')
    expect(claims.exp * 1000).toBeGreaterThan(Date.now())
    expect(claims.exp * 1000).toBeLessThanOrEqual(Date.now() + 24 * 3600_000)
    const ok = await crypto.webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      vapidPair.publicKey,
      Buffer.from(sig!, 'base64url'),
      Buffer.from(`${h}.${c}`),
    )
    expect(ok).toBe(true)
  })
})
