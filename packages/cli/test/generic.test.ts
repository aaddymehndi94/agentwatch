import {
  bind,
  buildCommand,
  type CommandBody,
  generateVaultKey,
  importVaultKey,
  open,
  type PushInfo,
  type RequestInfo,
  type SourceMessage,
} from '@agentwatch/protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AskRefused, GenericAdapter, pickedChoices } from '../src/adapters/generic.ts'
import { parseDuration } from '../src/commands/ask.ts'
import { Core, type CoreOptions } from '../src/daemon/core.ts'

const SOURCE = 'src-1'
let key: CryptoKey
let sent: SourceMessage[]
let now = Date.now()
const alive = new Set<number>()

async function make(over: Partial<CoreOptions> = {}) {
  // Phone commands carry a real timestamp, which core checks against its clock.
  now = Date.now()
  key = await importVaultKey(generateVaultKey())
  sent = []
  const core = new Core({
    sourceId: SOURCE,
    key,
    privacy: 'full',
    allowMessages: true,
    doneMinSeconds: 30,
    needsYouDelayMs: 0,
    send: (m) => sent.push(m),
    log: () => {},
    startedAt: now - 1000,
    now: () => now,
    ...over,
  })
  const generic = new GenericAdapter(core, { log: () => {}, now: () => now, pidAlive: (p) => alive.has(p) })
  core.register(generic)
  return { core, generic }
}

const of = <T extends SourceMessage['t']>(t: T) => sent.filter((m) => m.t === t) as Extract<SourceMessage, { t: T }>[]
const sessionState = (id: string) => of('session').findLast((m) => m.session.id === id)?.session

async function answer(core: Core, body: CommandBody) {
  await core.flushed()
  const req = of('request.open').at(-1)!.request
  await core.handleCommand(
    await buildCommand(key, { deviceId: 'dev-1', sourceId: SOURCE, sessionId: req.sessionId, requestId: req.id, body }),
  )
  return req
}

afterEach(() => {
  vi.useRealTimers()
  alive.clear()
})

describe('generic helpers', () => {
  it('reads the chosen labels back, even labels with commas in them', () => {
    expect(pickedChoices('Yes', ['Yes', 'No'])).toEqual(['Yes'])
    expect(pickedChoices('Red, green, Blue', ['Red, green', 'Blue', 'green'])).toEqual(['Red, green', 'Blue'])
    expect(pickedChoices('', ['Yes'])).toEqual([])
  })

  it('parses durations', () => {
    expect(parseDuration('90')).toBe(90_000)
    expect(parseDuration('90s')).toBe(90_000)
    expect(parseDuration('10m')).toBe(600_000)
    expect(parseDuration('1h30m')).toBe(5_400_000)
    expect(() => parseDuration('soon')).toThrow(/Not a duration/)
    expect(() => parseDuration('10x')).toThrow()
  })
})

describe('agentwatch emit', () => {
  it('reports a session of your own: working with a status line, then done, then ended', async () => {
    const { core, generic } = await make()
    generic.emit({
      session: 'nightly',
      state: 'working',
      message: 'Step 3 of 5',
      cwd: '/home/me/etl',
      title: 'Nightly',
    })
    await core.flushed()
    let s = sessionState('g:nightly')!
    expect(s).toMatchObject({ agent: 'generic', state: 'working', caps: { reply: false } })
    const info = await open(key, s.sealed!, bind.session(SOURCE, 'g:nightly'))
    expect(info).toMatchObject({ title: 'Nightly', project: 'etl', snippet: 'Step 3 of 5' })

    now += 45_000
    generic.emit({ session: 'nightly', state: 'idle', message: 'Loaded 1.2M rows' })
    await core.flushed()
    const [push] = of('push')
    expect(push?.push.kind).toBe('done')
    const pinfo = await open<PushInfo>(key, push!.push.sealed, bind.push(SOURCE, push!.push))
    expect(pinfo).toEqual({ title: 'Agent finished · etl', body: 'Loaded 1.2M rows' })

    generic.emit({ session: 'nightly', state: 'ended' })
    await core.flushed()
    s = sessionState('g:nightly')!
    expect(s.state).toBe('ended')
    // Emitting again starts it afresh.
    expect(generic.emit({ session: 'nightly', state: 'working' }).state).toBe('working')
  })

  it('ends a session when its process exits, or after a day of silence', async () => {
    const { core, generic } = await make()
    alive.add(4242)
    generic.emit({ session: 'watched', state: 'working', pid: 4242 })
    generic.emit({ session: 'forgotten', state: 'idle' })
    generic.sweep()
    expect(core.sessions.get('g:watched')?.state).toBe('working')
    alive.delete(4242)
    generic.sweep()
    expect(core.sessions.get('g:watched')?.state).toBe('ended')
    expect(core.sessions.get('g:forgotten')?.state).toBe('idle')
    now += 25 * 3600_000
    generic.sweep()
    expect(core.sessions.get('g:forgotten')?.state).toBe('ended')
  })
})

describe('agentwatch ask', () => {
  it('asks with choices and returns the phone’s pick; the one-off session then ends', async () => {
    const { core, generic } = await make()
    const ac = new AbortController()
    const pending = generic.ask(
      { question: 'Which env?', choices: ['staging', 'prod'], multi: false, approve: false, timeoutMs: 60_000 },
      ac.signal,
    )
    const req = await answer(core, { kind: 'answer', answers: { 'Which env?': 'staging' } })
    expect(await pending).toEqual({ status: 'answered', answers: ['staging'] })
    expect(req.kind).toBe('question')
    expect(req.answerable).toBe(true)
    const info = await open<RequestInfo>(key, req.sealed, bind.request(SOURCE, req))
    expect(info.questions?.[0]?.options.map((o) => o.label)).toEqual(['staging', 'prod'])
    await core.flushed()
    expect(sessionState(req.sessionId)?.state).toBe('ended')
    const push = of('push')[0]!.push
    expect(push).toMatchObject({ kind: 'needs_you', urgency: 'high', actions: false })
  })

  it('--approve is an approval with notification actions, and a denial carries the reason', async () => {
    const { core, generic } = await make()
    generic.emit({ session: 'deployer', state: 'working' })
    const pending = generic.ask(
      { question: 'Run the migration?', approve: true, multi: false, session: 'deployer', timeoutMs: 60_000 },
      new AbortController().signal,
    )
    const req = await answer(core, { kind: 'decide', behavior: 'deny', message: 'Not on a Friday' })
    expect(await pending).toEqual({ status: 'denied', message: 'Not on a Friday' })
    expect(req).toMatchObject({ kind: 'permission', sessionId: 'g:deployer' })
    expect(of('push')[0]!.push.actions).toBe(true)
    await core.flushed()
    // A named session lives on after the question.
    expect(sessionState('g:deployer')?.state).toBe('working')
  })

  it('times out, and a caller that goes away cancels the question', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { core, generic } = await make()
    const timed = generic.ask(
      { question: 'Ship?', multi: false, approve: false, timeoutMs: 5_000 },
      new AbortController().signal,
    )
    await vi.advanceTimersByTimeAsync(5_001)
    expect(await timed).toEqual({ status: 'expired' })

    const ac = new AbortController()
    const gone = generic.ask({ question: 'Ship?', multi: false, approve: false, timeoutMs: 60_000 }, ac.signal)
    ac.abort()
    expect(await gone).toEqual({ status: 'cancelled' })
    await core.flushed()
    expect(of('request.close').map((m) => m.status)).toEqual(['expired', 'cancelled'])
  })

  it('a session that ends while asking cancels the question', async () => {
    const { core, generic } = await make()
    generic.emit({ session: 'build', state: 'working' })
    const pending = generic.ask(
      { question: 'Retry the flaky test?', session: 'build', multi: false, approve: false, timeoutMs: 60_000 },
      new AbortController().signal,
    )
    generic.emit({ session: 'build', state: 'ended' })
    expect(await pending).toEqual({ status: 'cancelled' })
    expect([...core.requests.values()].every((r) => r.status !== 'open')).toBe(true)
  })

  it('refuses under summary privacy rather than showing an empty question', async () => {
    const { generic } = await make({ privacy: 'summary' })
    await expect(
      generic.ask(
        { question: 'Secret?', multi: false, approve: false, timeoutMs: 60_000 },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(AskRefused)
  })
})
