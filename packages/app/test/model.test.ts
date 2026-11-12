import type { StateView } from '@agentwatch/protocol'
import { bind, generateVaultKey, importVaultKey, seal } from '@agentwatch/protocol'
import { describe, expect, it } from 'vitest'
import { decryptState } from '../src/lib/model.ts'

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
        sealed: await seal(key, { title: 'Use Bash', tool: 'Bash', detail: 'ls' }, bind.request('a', 's1', 'r2')),
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
    ])
  })
})
