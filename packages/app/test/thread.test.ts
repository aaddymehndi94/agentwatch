import { describe, expect, it } from 'vitest'
import type { EventVM, SessionVM } from '../src/lib/model.ts'
import { thread } from '../src/lib/thread.ts'

const session = (over: Partial<SessionVM> = {}): SessionVM => ({
  key: 'a/s1',
  sourceId: 'a',
  id: 's1',
  agent: 'claude',
  state: 'working',
  stateSince: 0,
  startedAt: 0,
  turnStartedAt: 0,
  updatedAt: 0,
  caps: { reply: true, busyReply: 'queue' },
  info: { project: 'p' },
  background: 0,
  ...over,
})

const you = (items: ReturnType<typeof thread>) => items.filter((i) => i.k === 'you')

describe('timeline: replies from the phone', () => {
  it('a reply and the prompt it became are one bubble, from your phone', () => {
    // The prompt enters a few ms before the daemon hears the reply went in.
    const events: EventVM[] = [
      { at: 1_000, kind: 'prompted', text: 'Run the tests' },
      { at: 1_040, kind: 'replied', text: 'Run the tests' },
    ]
    expect(you(thread(events, session()))).toEqual([{ k: 'you', at: 1_040, text: 'Run the tests', phone: true }])
  })

  it('a queued reply shows as queued until its prompt enters after the turn', () => {
    const queued: EventVM = { at: 5_000, kind: 'queued', text: 'and update the docs' }
    expect(you(thread([queued], session()))).toEqual([
      { k: 'you', at: 5_000, text: 'and update the docs', phone: true, queued: true },
    ])
    const later: EventVM = { at: 900_000, kind: 'prompted', text: 'and update the docs' }
    expect(you(thread([queued, later], session()))).toEqual([
      { k: 'you', at: 5_000, text: 'and update the docs', phone: true },
    ])
  })

  it('the same text typed at the computer before the reply, or twice, stays its own prompt', () => {
    const events: EventVM[] = [
      { at: 1_000, kind: 'prompted', text: 'Continue' },
      { at: 60_000, kind: 'queued', text: 'Continue' },
      { at: 90_000, kind: 'prompted', text: 'Continue' },
      { at: 95_000, kind: 'prompted', text: 'Continue' },
    ]
    expect(you(thread(events, session())).map((i) => [i.at, i.phone])).toEqual([
      [1_000, false],
      [60_000, true],
      [95_000, false],
    ])
  })

  it("a queued reply goes last, under the agent's latest message", () => {
    const items = thread(
      [{ at: 5_000, kind: 'queued', text: 'next' }],
      session({ updatedAt: 4_000, info: { project: 'p', snippet: 'Running the migration.' } }),
    )
    expect(items.map((i) => i.k)).toEqual(['agent', 'you'])
  })

  it('a queued reply in a session that ended is not left looking queued', () => {
    const items = you(thread([{ at: 5_000, kind: 'queued', text: 'x' }], session({ state: 'ended' })))
    expect(items[0]).not.toHaveProperty('queued')
  })
})
