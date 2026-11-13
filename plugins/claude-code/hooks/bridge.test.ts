// The phone-reply bridge against a stand-in daemon: `$.http.fetch` answers the long-poll and records the acks, and
// `$.prompt.submit` enters the prompt only when the test says the running turn has ended.

import { expect, mock, test } from 'claude-code/testing'

const response = (status: number, body: unknown = {}) => ({
  value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) },
})

test('a reply sent while Claude works is acked as queued at once, and the next poll goes straight out', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { AGENTWATCH_HOME: '/aw' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const polls: string[] = []
  const acks: unknown[] = []
  on('http.fetch', (_, e) => {
    if (e.url.endsWith('/ack')) {
      acks.push(JSON.parse(String(e.init?.body)))
      return response(200)
    }
    polls.push(e.url)
    // The first poll brings the reply; later ones wait, like the daemon's long-poll.
    if (polls.length === 1) return response(200, { messages: [{ id: 'm1', text: 'and update the docs' }] })
    return clock.sleep(60_000).then(() => response(204))
  })
  let turnEnds: (() => void) | undefined
  on('prompt.submit', (_, e) => new Promise((resolve) => (turnEnds = () => resolve({ text: e.text }))))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(polls[0]).toContain('session=s1')
  expect(polls[0]).toContain('v=2')
  expect(acks).toEqual([])

  await clock.advance(1_500)
  expect(acks).toEqual([{ session: 's1', id: 'm1', ok: true, queued: true }])
  expect(polls).toHaveLength(2)

  // The turn ends and the prompt enters: nothing more to say.
  turnEnds?.()
  await clock.settle()
  expect(acks).toHaveLength(1)
})

test('a reply to an idle Claude enters at once and is acked as delivered, not queued', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { AGENTWATCH_HOME: '/aw' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const acks: unknown[] = []
  let polls = 0
  on('http.fetch', (_, e) => {
    if (e.url.endsWith('/ack')) {
      acks.push(JSON.parse(String(e.init?.body)))
      return response(200)
    }
    polls++
    if (polls === 1) return response(200, { messages: [{ id: 'm2', text: 'run the linter' }] })
    return clock.sleep(60_000).then(() => response(204))
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  expect(acks).toEqual([{ session: 's1', id: 'm2', ok: true }])
})

test('after a turn it reports the status line figures to its own daemon, and not for a subagent', async ($, on) => {
  const clock = mock.clock(on)
  mock.env(on, { AGENTWATCH_HOME: '/aw' })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('process.run', () => ({
    value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  const usage = {
    startedAt: 1,
    context: { tokens: 43_086, window: 1_000_000, percent: 4 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 23, resetsAt: '2026-11-13T15:40:00.000Z' }],
    cost: { usd: 0.0043 },
  }
  on('session.usage', () => ({ value: usage }))
  const posts: unknown[] = []
  on('http.fetch', (_, e) => {
    if (e.url.endsWith('/usage')) {
      posts.push(JSON.parse(String(e.init?.body)))
      return response(200)
    }
    return clock.sleep(60_000).then(() => response(204))
  })
  on('turn.complete', (_, e) => ({ text: e.answer }))

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.settle()
  await $.turn.complete({ turnId: 't1', agentId: 'a1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(posts).toEqual([])
  await $.turn.complete({ turnId: 't2', answer: 'done', durationMs: 1, isAborted: false, reason: 'answer' })
  await clock.settle()
  expect(posts).toEqual([
    { session: 's1', usage: { context: usage.context, rateLimits: usage.rateLimits, cost: usage.cost } },
  ])
})
