// A fake Web Push service for E2E tests: a browser-side subscription (P-256 key + auth secret) whose endpoint is a
// local HTTP server. Whatever the relay sends is decrypted here exactly as a phone's push service client would
// (RFC 8291 / RFC 8188 aes128gcm), so tests see the real payload, end to end.

import crypto from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const hmac = (key: Uint8Array, data: Uint8Array) => crypto.createHmac('sha256', key).update(data).digest()

export function decryptPush(body: Uint8Array, ua: crypto.ECDH, auth: Uint8Array): string {
  const salt = body.subarray(0, 16)
  const idlen = body[20]!
  const asPublic = body.subarray(21, 21 + idlen)
  const records = body.subarray(21 + idlen)
  const prkKey = hmac(auth, ua.computeSecret(asPublic))
  const ikm = hmac(
    prkKey,
    Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]),
  )
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12)
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(records.subarray(records.length - 16))
  const plain = Buffer.concat([d.update(records.subarray(0, records.length - 16)), d.final()])
  let end = plain.length
  while (end > 0 && plain[end - 1] === 0) end--
  return plain.subarray(0, end - 1).toString('utf8')
}

export interface ReceivedPush {
  headers: http.IncomingHttpHeaders
  payload: Record<string, unknown> & { kind?: string; tag?: string; sealed?: string; title?: string; body?: string }
}

export class FakePushService {
  readonly received: ReceivedPush[] = []
  private ua = crypto.createECDH('prime256v1')
  private auth = crypto.randomBytes(16)
  private server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      try {
        const payload = JSON.parse(decryptPush(Buffer.concat(chunks), this.ua, this.auth))
        this.received.push({ headers: req.headers, payload })
        res.writeHead(201).end()
      } catch {
        res.writeHead(400).end()
      }
    })
  })
  private port = 0

  constructor() {
    this.ua.generateKeys()
  }

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()))
    this.port = (this.server.address() as AddressInfo).port
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()))
  }

  subscription() {
    return {
      endpoint: `http://127.0.0.1:${this.port}/push/${crypto.randomBytes(6).toString('hex')}`,
      keys: { p256dh: this.ua.getPublicKey().toString('base64url'), auth: this.auth.toString('base64url') },
    }
  }

  of(kind: string): ReceivedPush[] {
    return this.received.filter((p) => p.payload.kind === kind)
  }
}
