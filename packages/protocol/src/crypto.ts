// End-to-end crypto shared by the daemon (Node), the relay (Workers) and the app (browser).
// WebCrypto only. The relay never holds the vault key; it only stores and forwards sealed strings.

import { fromB64u, fromUtf8, toB64u, utf8 } from './b64.ts'

export const PROTOCOL_VERSION = 1 as const
const VAULT_KEY_BYTES = 32
const IV_BYTES = 12

/** Fields a sealed blob is bound to. Changing any of them makes `open` fail. */
export type Binding = Record<string, string | number | boolean | null | undefined>

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

/** URL-safe random identifier (default 16 bytes = 128 bits). */
export function randomId(bytes = 16): string {
  return toB64u(randomBytes(bytes))
}

export function generateVaultKey(): string {
  return toB64u(randomBytes(VAULT_KEY_BYTES))
}

export async function importVaultKey(rawB64u: string, extractable = false): Promise<CryptoKey> {
  const raw = fromB64u(rawB64u)
  if (raw.length !== VAULT_KEY_BYTES) throw new Error('vault key must be 32 bytes')
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, extractable, ['encrypt', 'decrypt'])
}

/** Canonical associated data: JSON of the binding with sorted keys and undefined values dropped. */
export function canonicalAad(binding: Binding): Uint8Array {
  const keys = Object.keys(binding)
    .filter((k) => binding[k] !== undefined)
    .sort()
  const obj: Record<string, unknown> = { v: PROTOCOL_VERSION }
  for (const k of keys) obj[k] = binding[k]
  return utf8(JSON.stringify(obj, Object.keys(obj).sort()))
}

/** Encrypt a JSON value with AES-256-GCM, bound to `binding`. Returns base64url(iv ‖ ciphertext+tag). */
export async function seal(key: CryptoKey, value: unknown, binding: Binding): Promise<string> {
  const iv = randomBytes(IV_BYTES)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: canonicalAad(binding) as BufferSource },
    key,
    utf8(JSON.stringify(value)) as BufferSource,
  )
  const out = new Uint8Array(IV_BYTES + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), IV_BYTES)
  return toB64u(out)
}

export class SealError extends Error {
  constructor(message = 'could not open sealed value') {
    super(message)
    this.name = 'SealError'
  }
}

/** Decrypt and authenticate. Throws SealError when the key, binding or data don't match. */
export async function open<T = unknown>(key: CryptoKey, sealed: string, binding: Binding): Promise<T> {
  let bytes: Uint8Array
  try {
    bytes = fromB64u(sealed)
  } catch {
    throw new SealError('malformed sealed value')
  }
  if (bytes.length < IV_BYTES + 16) throw new SealError('sealed value too short')
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: bytes.subarray(0, IV_BYTES) as BufferSource,
        additionalData: canonicalAad(binding) as BufferSource,
      },
      key,
      bytes.subarray(IV_BYTES) as BufferSource,
    )
    return JSON.parse(fromUtf8(new Uint8Array(pt))) as T
  } catch {
    throw new SealError()
  }
}

// ── Pairing ────────────────────────────────────────────────────────────────────────────────────────────────────────
// The vault key travels to a new device/source wrapped under a one-time secret that only appears in the pairing
// link's #fragment (never sent to the relay). The relay stores the wrapped blob and deletes it on first claim.

async function wrapKeyFromSecret(secretB64u: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', fromB64u(secretB64u) as BufferSource, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0) as BufferSource,
      info: utf8('agentwatch/pair/v1') as BufferSource,
    },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface PairingSecret {
  pairId: string
  secret: string
}

export function newPairingSecret(): PairingSecret {
  return { pairId: randomId(12), secret: randomId(32) }
}

export async function wrapVaultKey(vaultKeyB64u: string, p: PairingSecret): Promise<string> {
  return seal(await wrapKeyFromSecret(p.secret), { k: vaultKeyB64u }, { kind: 'pair', pairId: p.pairId })
}

export async function unwrapVaultKey(wrapped: string, p: PairingSecret): Promise<string> {
  const { k } = await open<{ k: string }>(await wrapKeyFromSecret(p.secret), wrapped, {
    kind: 'pair',
    pairId: p.pairId,
  })
  if (fromB64u(k).length !== VAULT_KEY_BYTES) throw new SealError('bad vault key')
  return k
}

/** `<pairId>.<secret>`, the part of a pairing link after `#/pair/` (devices) or `#/join/` (sources). */
export function formatPairingCode(p: PairingSecret): string {
  return `${p.pairId}.${p.secret}`
}

export function parsePairingCode(code: string): PairingSecret {
  const m = /^([A-Za-z0-9_-]{8,64})\.([A-Za-z0-9_-]{40,64})$/.exec(code.trim())
  if (!m) throw new Error('not a pairing code')
  return { pairId: m[1]!, secret: m[2]! }
}

/** SHA-256 hex, used by the relay to store bearer tokens as hashes. */
export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(s) as BufferSource))
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
