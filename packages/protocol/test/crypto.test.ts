import { describe, expect, it } from 'vitest'
import {
  buildCommand,
  formatPairingCode,
  generateVaultKey,
  importVaultKey,
  newPairingSecret,
  open,
  parsePairingCode,
  SealError,
  seal,
  unwrapVaultKey,
  verifyCommand,
  wrapVaultKey,
} from '../src/index.ts'

const key = () => importVaultKey(generateVaultKey())

describe('seal/open', () => {
  it('round-trips a value bound to its ids', async () => {
    const k = await key()
    const s = await seal(k, { snippet: 'PONG' }, { kind: 'session', sourceId: 'a', sessionId: 'b' })
    await expect(open(k, s, { kind: 'session', sourceId: 'a', sessionId: 'b' })).resolves.toEqual({ snippet: 'PONG' })
  })

  it('binding key order does not matter', async () => {
    const k = await key()
    const s = await seal(k, 1, { a: '1', b: 2 })
    await expect(open(k, s, { b: 2, a: '1' })).resolves.toBe(1)
  })

  it('rejects the same blob presented under another id (relay swapping blobs)', async () => {
    const k = await key()
    const s = await seal(k, { detail: 'ls' }, { kind: 'request', requestId: 'r1' })
    await expect(open(k, s, { kind: 'request', requestId: 'r2' })).rejects.toBeInstanceOf(SealError)
  })

  it('rejects tampering and the wrong key', async () => {
    const k = await key()
    const s = await seal(k, 'x', {})
    const flipped = s.slice(0, -2) + (s.at(-2) === 'A' ? 'B' : 'A') + s.at(-1)
    await expect(open(k, flipped, {})).rejects.toBeInstanceOf(SealError)
    await expect(open(await key(), s, {})).rejects.toBeInstanceOf(SealError)
    await expect(open(k, 'not!base64', {})).rejects.toBeInstanceOf(SealError)
  })
})

describe('pairing', () => {
  it('hands over the vault key with the one-time secret only', async () => {
    const vk = generateVaultKey()
    const p = newPairingSecret()
    const wrapped = await wrapVaultKey(vk, p)
    const code = formatPairingCode(p)
    expect(await unwrapVaultKey(wrapped, parsePairingCode(code))).toBe(vk)
    await expect(unwrapVaultKey(wrapped, { ...p, secret: newPairingSecret().secret })).rejects.toBeInstanceOf(SealError)
    await expect(unwrapVaultKey(wrapped, { ...p, pairId: 'otherpairid1' })).rejects.toBeInstanceOf(SealError)
    expect(() => parsePairingCode('nope')).toThrow()
  })
})

describe('commands', () => {
  const base = { deviceId: 'dev1', sourceId: 'src1', sessionId: 'ses1', requestId: 'req1' }

  async function setup() {
    const k = await key()
    const seen = new Set<string>()
    const seenNonce = (n: string) => {
      if (seen.has(n)) return true
      seen.add(n)
      return false
    }
    return { k, seenNonce }
  }

  it('verifies a fresh command once', async () => {
    const { k, seenNonce } = await setup()
    const c = await buildCommand(k, { ...base, body: { kind: 'decide', behavior: 'allow' } })
    const v = await verifyCommand(k, c, { sourceId: 'src1', notBefore: 0, seenNonce })
    expect(v).toEqual({ ok: true, body: { kind: 'decide', behavior: 'allow' } })
    expect(await verifyCommand(k, c, { sourceId: 'src1', notBefore: 0, seenNonce })).toEqual({
      ok: false,
      reason: 'replay',
    })
  })

  it('rejects stale, pre-restart, misrouted and retargeted commands', async () => {
    const { k, seenNonce } = await setup()
    const now = Date.now()
    const old = await buildCommand(k, { ...base, body: { kind: 'decide', behavior: 'allow' }, now: now - 6 * 60_000 })
    expect((await verifyCommand(k, old, { sourceId: 'src1', notBefore: 0, seenNonce })).ok).toBe(false)

    const c = await buildCommand(k, { ...base, body: { kind: 'decide', behavior: 'allow' }, now: now - 1000 })
    expect(await verifyCommand(k, c, { sourceId: 'src1', notBefore: now, seenNonce })).toEqual({
      ok: false,
      reason: 'expired',
    })
    expect(await verifyCommand(k, c, { sourceId: 'other', notBefore: 0, seenNonce })).toEqual({
      ok: false,
      reason: 'wrong source',
    })
    // The relay points an "allow" at a different request: the seal no longer opens.
    const moved = { ...c, requestId: 'req2' }
    expect(await verifyCommand(k, moved, { sourceId: 'src1', notBefore: 0, seenNonce })).toEqual({
      ok: false,
      reason: 'bad seal',
    })
  })
})
