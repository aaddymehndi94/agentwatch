// End to end: recorded Claude hook payloads → hook client → on-demand daemon → relay (workerd) → fake phone, and the
// phone's sealed commands back into the held hook. One relay and one OS-user home per file.

import fs from 'node:fs'
import path from 'node:path'
import {
  bind,
  type EventInfo,
  parsePairingCode,
  type RequestInfo,
  type SessionInfo,
  type StateView,
} from '@agentwatch/protocol'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { call } from '../src/client.ts'
import {
  BIN,
  buildCli,
  FakeDevice,
  hook,
  loadClaudeFixture,
  type Relay,
  run,
  socketOf,
  startRelay,
  tempHome,
  waitFor,
} from './harness.ts'

const fixture = loadClaudeFixture()
const byEvent = (name: string, n = 0) => fixture.filter((e) => e.hook_event_name === name)[n]!
const SID = String(fixture[0]!.session_id)
const STOP_MESSAGE = String(byEvent('Stop').last_assistant_message)

let relay: Relay
let home: string
let phone: FakeDevice
let sourceId: string

const session = (s: StateView) => s.sessions.find((x) => x.id === SID)

beforeAll(async () => {
  buildCli()
  relay = await startRelay()
  home = tempHome()
}, 120_000)

afterAll(async () => {
  if (home) {
    await run(BIN, ['stop'], home).catch(() => {})
    fs.rmSync(home, { recursive: true, force: true })
  }
  await relay?.stop()
})

describe('fail-open hook', () => {
  it('exits 0 fast with no stdout and starts nothing when this user is not set up', async () => {
    const empty = tempHome()
    const r = await hook(empty, byEvent('Stop'))
    expect(r.code).toBe(0)
    expect(r.stdout).toBe('')
    expect(r.ms).toBeLessThan(1200)
    expect(fs.existsSync(socketOf(empty))).toBe(false)
    fs.rmSync(empty, { recursive: true, force: true })
  })

  it('exits 0 with no stdout on garbage input', async () => {
    const r = await run(BIN.replace('agentwatch.mjs', 'hook.mjs'), ['claude'], home, 'not json')
    expect(r).toMatchObject({ code: 0, stdout: '' })
  })
})

describe('walking skeleton', () => {
  it('setup claims the relay and starts a connected daemon', async () => {
    const r = await run(BIN, ['setup', '--relay', relay.url, '--claim-secret', relay.claimSecret], home)
    expect(r.stderr).toBe('')
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('connected to your relay')
    const cfgFile = path.join(home, 'config.json')
    expect(fs.statSync(cfgFile).mode & 0o777).toBe(0o600)
    expect(fs.statSync(path.join(home, 'state')).mode & 0o777).toBe(0o700)
    // Push needs_you immediately in tests, then let the next hook restart the daemon with this config.
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
    cfg.notify.needsYouDelaySeconds = 0
    fs.writeFileSync(cfgFile, JSON.stringify(cfg), { mode: 0o600 })
    sourceId = cfg.sourceId
    expect((await run(BIN, ['stop'], home)).code).toBe(0)
    expect(fs.existsSync(socketOf(home))).toBe(false)
    // A second claim must fail: the relay is owned now.
    const again = await fetch(`${relay.url}/api/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claimSecret: relay.claimSecret }),
    })
    expect(again.status).toBe(409)
  }, 30_000)

  it('the first hook starts the daemon on demand and the session shows up working', async () => {
    const r = await hook(home, byEvent('UserPromptSubmit'))
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1500)
    await waitFor('daemon socket', async () => fs.existsSync(socketOf(home)))
    phone = await waitFor('pairing', () => FakeDevice.pair(relay.url, home))
    const s = await waitFor('working session', async () => {
      const x = session(await phone.state())
      return x?.state === 'working' ? x : undefined
    })
    const info = await phone.open<SessionInfo>(s.sealed, bind.session(sourceId, SID))
    expect(info.project).toBe('work')
    expect(info.title).toContain('First use Bash')
    const src = (await phone.state()).sources.find((x) => x.id === sourceId)
    expect(src).toMatchObject({ online: true, privacy: 'full' })
    expect(src?.adapters.claude).toMatch(/^claude/)
  }, 30_000)

  it('holds a permission request until the phone approves it', async () => {
    const held = hook(home, byEvent('PermissionRequest', 0))
    const st = await waitFor('open permission', async () => {
      const s = await phone.state()
      return s.requests.find((r) => r.sessionId === SID && r.status === 'open') ? s : undefined
    })
    expect(session(st)?.state).toBe('needs_you')
    const req = st.requests.find((r) => r.sessionId === SID && r.status === 'open')!
    expect(req).toMatchObject({ kind: 'permission', answerable: true })
    const info = await phone.open<RequestInfo>(req.sealed, bind.request(sourceId, SID, req.id))
    expect(info).toMatchObject({ tool: 'Bash', detail: 'date > s3.txt' })

    const cmd = await phone.command({
      sourceId,
      sessionId: SID,
      requestId: req.id,
      body: { kind: 'decide', behavior: 'allow' },
    })
    const out = await held
    expect(out.code).toBe(0)
    expect(JSON.parse(out.stdout)).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    })
    expect(await waitFor('applied', async () => (await phone.commandStatus(cmd)).status === 'applied')).toBe(true)
    await hook(home, byEvent('PostToolUse', 0))
    const after = await waitFor('working again', async () => {
      const s = await phone.state()
      return session(s)?.state === 'working' ? s : undefined
    })
    expect(after.requests.find((r) => r.id === req.id)?.status).toBe('answered')

    // The same request can't be answered twice.
    const late = await phone.command({
      sourceId,
      sessionId: SID,
      requestId: req.id,
      body: { kind: 'decide', behavior: 'deny' },
    })
    const ack = await waitFor('rejected', async () => {
      const c = await phone.commandStatus(late)
      return c.status === 'rejected' ? c : undefined
    })
    expect(ack.detail).toMatch(/already answered/i)
  }, 30_000)

  it('releases a held question silently when it is answered in the terminal', async () => {
    const held = hook(home, byEvent('PermissionRequest', 1))
    const req = await waitFor('open question', async () =>
      (await phone.state()).requests.find((r) => r.sessionId === SID && r.status === 'open'),
    )
    expect(req.kind).toBe('question')
    const info = await phone.open<RequestInfo>(req.sealed, bind.request(sourceId, SID, req.id))
    expect(info.questions?.[0]).toMatchObject({ question: 'Ship it?', options: [{ label: 'Yes' }, { label: 'No' }] })
    // Claude answered locally: the PostToolUse carries the same input plus `answers`.
    await hook(home, byEvent('PostToolUse', 1))
    const out = await held
    expect(out).toMatchObject({ code: 0, stdout: '' })
    await waitFor('answered locally', async () =>
      (await phone.state()).requests.find((r) => r.id === req.id && r.status === 'answered_locally'),
    )
  }, 30_000)

  it('Stop makes the session idle with the last message as its snippet, and logs a timeline', async () => {
    await hook(home, byEvent('Stop'))
    const s = await waitFor('idle session', async () => {
      const x = session(await phone.state())
      return x?.state === 'idle' ? x : undefined
    })
    const info = await phone.open<SessionInfo>(s.sealed, bind.session(sourceId, SID))
    expect(info.snippet).toBe(STOP_MESSAGE)

    const events = (
      await phone.get<{ sessionId: string; at: number; kind: string; sealed?: string }[]>(
        `/api/sessions/${sourceId}/${SID}/events`,
      )
    ).body
    const kinds = events.map((e) => e.kind).reverse()
    expect(kinds).toEqual(['prompted', 'needs_you', 'answered', 'needs_you', 'answered', 'done'])
    const done = events.find((e) => e.kind === 'done')!
    const text = await phone.open<EventInfo>(done.sealed, bind.event(sourceId, done))
    expect(text.text).toBe(STOP_MESSAGE)
  }, 30_000)

  it('the relay cannot read or forge anything: sealed blobs fail under a different binding', async () => {
    const s = session(await phone.state())!
    await expect(phone.open(s.sealed, bind.session(sourceId, 'another-session'))).rejects.toThrow()
  })

  it('SessionEnd marks the session ended', async () => {
    await hook(home, byEvent('SessionEnd'))
    await waitFor('ended', async () => session(await phone.state())?.state === 'ended')
  }, 30_000)

  it('with the daemon stopped, a hook still exits 0 quickly and brings the daemon back', async () => {
    expect((await run(BIN, ['stop'], home)).code).toBe(0)
    const r = await hook(home, { ...byEvent('UserPromptSubmit'), session_id: 'second-session' })
    expect(r).toMatchObject({ code: 0, stdout: '' })
    expect(r.ms).toBeLessThan(1200)
    await waitFor('daemon back', async () => fs.existsSync(socketOf(home)))
    await waitFor('reconnected', async () => (await phone.state()).sources.find((x) => x.id === sourceId)?.online)
  }, 30_000)
})

describe('pairing, phones and notifications', () => {
  it('a pairing code works exactly once', async () => {
    const r = await call<{ code: string }>('POST', '/v1/pair', { kind: 'device' }, { socket: socketOf(home) })
    expect(r.status).toBe(200)
    const { pairId } = parsePairingCode(r.body.code)
    const claim = () =>
      fetch(`${relay.url}/api/pair/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pairId, name: 'Once' }),
      })
    expect((await claim()).status).toBe(200)
    expect((await claim()).status).toBe(410)
  }, 30_000)

  it('a phone removed from Settings loses access at once', async () => {
    const other = await FakeDevice.pair(relay.url, home)
    expect((await other.fetch('GET', '/api/state')).status).toBe(200)
    expect((await phone.fetch('DELETE', `/api/devices/${other.deviceId}`)).status).toBe(200)
    expect((await other.fetch('GET', '/api/state')).status).toBe(401)
    expect((await phone.fetch('GET', '/api/state')).status).toBe(200)
  }, 30_000)

  it('`agentwatch mute` mutes every phone until the given time, and `mute off` clears it', async () => {
    const before = Date.now()
    const r = await run(BIN, ['mute', '2h'], home)
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('muted until')
    const muted = await waitFor('mute', async () => (await phone.state()).mute ?? undefined)
    expect(muted).toBeGreaterThanOrEqual(before + 2 * 3600_000 - 5000)
    expect(muted).toBeLessThanOrEqual(Date.now() + 2 * 3600_000 + 5000)
    expect((await run(BIN, ['mute', 'off'], home)).code).toBe(0)
    await waitFor('unmuted', async () => (await phone.state()).mute === null)
  }, 30_000)

  it('`agentwatch doctor --test-push` checks the chain and explains a phone without notifications', async () => {
    const r = await run(BIN, ['doctor', '--test-push'], home)
    expect(r.stdout).toContain('✓ Daemon running')
    expect(r.stdout).toContain('✓ Relay connected')
    expect(r.stdout).toContain('No paired phone has notifications on')
    expect(r.code).toBe(1)
  }, 30_000)
})

describe('phone replies into Claude', () => {
  const RID = 'reply-session'
  const modPoll = (loop: string) =>
    call<{ messages: { id: string; text: string }[] }>(
      'GET',
      `/v1/bridge/claude?session=${RID}&loop=${loop}`,
      undefined,
      { socket: socketOf(home), timeoutMs: 40_000 },
    )
  const replySession = async () => (await phone.state()).sessions.find((x) => x.id === RID)

  it('an idle session whose plugin mod is polling takes a reply from the phone as its next prompt', async () => {
    // The recorded session started before hooks were on, so SessionStart is synthesized from its first event.
    const first = fixture[0]!
    await hook(home, { session_id: RID, cwd: first.cwd, hook_event_name: 'SessionStart', source: 'startup' })
    const poll = modPoll('loop-1')
    const s = await waitFor('reply capability', async () => {
      const x = await replySession()
      return x?.caps.reply ? x : undefined
    })
    expect(s.state).toBe('idle')
    const cmd = await phone.command({
      sourceId,
      sessionId: RID,
      body: { kind: 'message', text: 'Now run the linter.' },
    })
    const r = await poll
    expect(r.status).toBe(200)
    const m = r.body.messages[0]!
    expect(m.text).toBe('Now run the linter.')
    const ack = await call(
      'POST',
      '/v1/bridge/claude/ack',
      { session: RID, id: m.id, ok: true },
      { socket: socketOf(home) },
    )
    expect(ack.status).toBe(200)
    await waitFor('applied', async () => (await phone.commandStatus(cmd)).status === 'applied')
    // Claude then runs the prompt like any other: the session is busy and can't take another reply.
    await hook(home, { ...byEvent('UserPromptSubmit'), session_id: RID, prompt: 'Now run the linter.' })
    const busy = await waitFor('working', async () => {
      const x = await replySession()
      return x?.state === 'working' ? x : undefined
    })
    expect(busy.caps).toEqual({ reply: false, replyReason: 'You can reply when the agent is idle' })
    const refused = await phone.command({ sourceId, sessionId: RID, body: { kind: 'message', text: 'and this?' } })
    await waitFor('rejected', async () => (await phone.commandStatus(refused)).status === 'rejected')
  }, 60_000)

  it('a reloaded plugin takes over the session and the old mod loop is told to stop', async () => {
    // loop-2 stays parked on the daemon; it is cut off when the daemon stops at the end of the file.
    modPoll('loop-2').catch(() => {})
    await new Promise((r) => setTimeout(r, 200))
    expect((await modPoll('loop-1')).status).toBe(410)
  }, 60_000)

  it('a session without the mod says why it cannot take replies', async () => {
    await hook(home, { ...byEvent('Stop'), session_id: 'second-session' })
    const s = await waitFor('idle', async () => {
      const x = (await phone.state()).sessions.find((y) => y.id === 'second-session')
      return x?.state === 'idle' ? x : undefined
    })
    expect(s.caps.reply).toBe(false)
    expect(s.caps.replyReason).toMatch(/AgentWatch plugin/)
  }, 30_000)
})
