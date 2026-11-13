import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, getState, READ_TIMEOUT_MS } from '../src/lib/api.ts'

/** A request on a dead connection: nothing ever comes back, until it is aborted. */
const never = (init?: RequestInit) =>
  new Promise<never>((_, reject) =>
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
  )

describe('reading state from the relay', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('gives up on a request stuck on a dead connection, so the app says its data is old instead of freezing', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', (_path: string, init?: RequestInit) => never(init))
    const result = getState('token').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    const e = await result
    expect(e).toBeInstanceOf(ApiError)
    expect((e as ApiError).status).toBe(0)
  })

  it('also gives up when the answer starts but never finishes arriving', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', async (_path: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => never(init),
    }))
    const result = getState('token').catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    expect(await result).toBeInstanceOf(ApiError)
  })

  it('still returns a prompt answer', async () => {
    const state = { serverTime: 1, mute: null, sources: [], sessions: [], requests: [] }
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => state }))
    expect(await getState('token')).toEqual(state)
  })
})
