import type { StateView } from '@agentwatch/protocol'
import { bind, generateVaultKey, importVaultKey, seal } from '@agentwatch/protocol'
import { describe, expect, it } from 'vitest'
import { backgroundWork, decryptEvents, decryptState, splitBackgroundLabel } from '../src/lib/model.ts'

async function state(key: CryptoKey, other: CryptoKey): Promise<StateView> {
  const now = Date.now()
  const base = {
    agent: 'claude' as const,
    state: 'idle' as const,
    stateSince: now,
    startedAt: now,
    turnStartedAt: null,
    updatedAt: now,
    caps: { reply: false },
  }
  return {
    serverTime: now,
    mute: null,
    sources: [],
    sessions: [
      { ...base, sourceId: 'a', id: 's1', sealed: await seal(key, { project: 'api' }, bind.session('a', 's1')) },
      // Sealed for s1 but presented as s2: a relay swapping blobs between sessions.
      { ...base, sourceId: 'a', id: 's2', sealed: await seal(key, { project: 'api' }, bind.session('a', 's1')) },
      { ...base, sourceId: 'a', id: 's3', sealed: await seal(other, { project: 'x' }, bind.session('a', 's3')) },
    ],
    requests: [
      {
        sourceId: 'a',
        id: 'r2',
        sessionId: 's1',
        kind: 'permission',
        createdAt: now,
        status: 'open',
        answerable: true,
        sealed: await seal(
          key,
          { title: 'Use Bash', tool: 'Bash', detail: 'ls' },
          bind.request('a', { sessionId: 's1', id: 'r2', kind: 'permission' }),
        ),
      },
      {
        sourceId: 'a',
        id: 'r1',
        sessionId: 's1',
        kind: 'permission',
        createdAt: now - 1000,
        status: 'open',
        answerable: true,
        sealed: 'garbage',
      },
      // A permission the relay presents as a question.
      {
        sourceId: 'a',
        id: 'r3',
        sessionId: 's1',
        kind: 'question',
        createdAt: now + 1000,
        status: 'open',
        answerable: true,
        sealed: await seal(
          key,
          { title: 'Use Bash', detail: 'ls' },
          bind.request('a', { sessionId: 's1', id: 'r3', kind: 'permission' }),
        ),
      },
    ],
  }
}

describe('decryptState', () => {
  it('opens what is bound correctly and marks swapped, foreign or broken blobs unreadable', async () => {
    const key = await importVaultKey(generateVaultKey())
    const other = await importVaultKey(generateVaultKey())
    const m = await decryptState(await state(key, other), key)
    expect(m.sessions.map((s) => s.info)).toEqual([{ project: 'api' }, null, null])
    expect(m.requests.map((r) => [r.id, r.seq, r.info?.detail ?? null])).toEqual([
      ['r1', 1, null],
      ['r2', 2, 'ls'],
      ['r3', 3, null],
    ])
  })
})

describe('decryptEvents', () => {
  it('shows only the asked-for session, even if the relay relabels another session’s event', async () => {
    const key = await importVaultKey(generateVaultKey())
    const at = Date.now()
    const own = { sessionId: 's1', at, kind: 'done' }
    const other = { sessionId: 's2', at: at + 1, kind: 'done' }
    const events = [
      { ...own, sealed: await seal(key, { text: 'mine' }, bind.event('a', own)) },
      // Sealed for s2, relabelled as s1.
      { ...other, sessionId: 's1', sealed: await seal(key, { text: 'theirs' }, bind.event('a', other)) },
      { ...other, sealed: await seal(key, { text: 'theirs' }, bind.event('a', other)) },
    ]
    expect(await decryptEvents(events, 'a', 's1', key)).toEqual([
      { at, kind: 'done', text: 'mine' },
      { at: at + 1, kind: 'done' },
    ])
  })
})

describe('waiting on background work', () => {
  it('says what a session waits on, from its labels, or from the count alone under summary privacy', () => {
    expect(backgroundWork(1, ['Agent · Explore: find the hooks'])).toBe('a background agent')
    expect(backgroundWork(2, ['Agent · Explore: a', 'Agent · review'])).toBe('2 background agents')
    expect(backgroundWork(1, ['Workflow · review-changes'])).toBe('a background workflow')
    expect(backgroundWork(3, ['Agent · a', 'Workflow · x', 'Agent · y'])).toBe('3 background tasks')
    expect(backgroundWork(2, undefined)).toBe('2 background tasks')
    expect(backgroundWork(1, undefined)).toBe('a background task')
  })

  it('splits a label into its kind and what it is doing', () => {
    expect(splitBackgroundLabel('Agent · Explore: a · b')).toEqual({ kind: 'Agent', what: 'Explore: a · b' })
    expect(splitBackgroundLabel('Monitor')).toEqual({ kind: 'Monitor', what: '' })
  })

  it('carries the count through from the relay, and 0 from daemons that never send it', async () => {
    const key = await importVaultKey(generateVaultKey())
    const session = (id: string, background?: number) => ({
      sourceId: 'a',
      id,
      agent: 'claude' as const,
      state: 'working' as const,
      stateSince: 1,
      startedAt: 1,
      turnStartedAt: 1,
      updatedAt: 1,
      caps: { reply: false },
      ...(background !== undefined ? { background } : {}),
    })
    const raw: StateView = {
      serverTime: 1,
      mute: null,
      sources: [],
      requests: [],
      sessions: [session('s1', 2), session('s2')],
    }
    const model = await decryptState(raw, key)
    expect(model.sessions.map((s) => s.background)).toEqual([2, 0])
  })
})
