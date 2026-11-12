import type { StateView } from '@agentwatch/protocol'
import { bind, generateVaultKey, importVaultKey, seal } from '@agentwatch/protocol'
import { describe, expect, it } from 'vitest'
import { decryptEvents, decryptState } from '../src/lib/model.ts'

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
