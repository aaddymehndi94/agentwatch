import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeBridge, NOT_CONNECTED, POLL_MS } from '../src/adapters/claude-bridge.ts'

describe('ClaudeBridge', () => {
  let links: [string, boolean][]
  let bridge: ClaudeBridge

  beforeEach(() => {
    vi.useFakeTimers()
    links = []
    bridge = new ClaudeBridge({ onLink: (sid, c) => links.push([sid, c]) })
  })
  afterEach(() => {
    bridge.stop()
    vi.useRealTimers()
  })

  it('refuses a message for a session whose mod never polled', async () => {
    expect(await bridge.send('s1', 'hi')).toEqual({ ok: false, reason: NOT_CONNECTED })
  })

  it('hands a message to the waiting poll and resolves once the mod acks it', async () => {
    const poll = bridge.poll('s1', 'loopA')
    expect(links).toEqual([['s1', true]])
    const sent = bridge.send('s1', 'run the tests again')
    const msgs = await poll
    expect(msgs).toEqual([{ id: expect.any(String), text: 'run the tests again' }])
    const [m] = msgs as { id: string }[]
    expect(bridge.ack('s1', m!.id, true)).toBe(true)
    expect(await sent).toEqual({ ok: true })
    expect(bridge.ack('s1', m!.id, true)).toBe(false)
  })

  it('queues a message sent between polls and delivers it on the next poll', async () => {
    const first = bridge.poll('s1', 'loopA')
    await vi.advanceTimersByTimeAsync(POLL_MS)
    expect(await first).toEqual([])
    const sent = bridge.send('s1', 'later')
    const [m] = (await bridge.poll('s1', 'loopA')) as { id: string; text: string }[]
    expect(m!.text).toBe('later')
    bridge.ack('s1', m!.id, false, 'a hook dropped it')
    expect(await sent).toEqual({ ok: false, reason: 'Claude refused the message: a hook dropped it' })
  })

  it('reports a failure when Claude takes a message but never confirms it', async () => {
    void bridge.poll('s1', 'loopA')
    const sent = bridge.send('s1', 'x')
    await vi.advanceTimersByTimeAsync(31_000)
    expect(await sent).toMatchObject({ ok: false, reason: expect.stringMatching(/did not confirm/) })
  })

  it('a newer mod loop takes over the session and the old one is told to stop', async () => {
    const old = bridge.poll('s1', 'loopA')
    const fresh = bridge.poll('s1', 'loopB')
    expect(await old).toEqual([])
    expect(await bridge.poll('s1', 'loopA')).toBe('superseded')
    const sent = bridge.send('s1', 'to the new loop')
    const [m] = (await fresh) as { id: string }[]
    bridge.ack('s1', m!.id, true)
    expect(await sent).toEqual({ ok: true })
  })

  it('an aborted poll stops waiting, and the session drops off once the mod stops polling', async () => {
    const ac = new AbortController()
    const p = bridge.poll('s1', 'loopA', ac.signal)
    ac.abort()
    expect(await p).toEqual([])
    expect(bridge.connected('s1')).toBe(true)
    await vi.advanceTimersByTimeAsync(45_000)
    expect(bridge.connected('s1')).toBe(false)
    expect(links).toEqual([
      ['s1', true],
      ['s1', false],
    ])
  })
})
