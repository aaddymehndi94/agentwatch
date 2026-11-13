// The Codex adapter against a fake app-server: a real WebSocket server on a unix socket that speaks the JSON-RPC
// recorded from codex-cli 0.166 (test/fixtures/codex-0.166.0-attach-approve-turnstart.jsonl).

import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {
  buildCommand,
  type CommandBody,
  generateVaultKey,
  importVaultKey,
  type SourceMessage,
} from '@agentwatch/protocol'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type WebSocket, WebSocketServer } from 'ws'
import { CodexAdapter, codexTuiAlive, unwrapShell } from '../src/adapters/codex.ts'
import { Core } from '../src/daemon/core.ts'
import { CLI_DIR } from './harness.ts'

type Json = Record<string, unknown>
const SOURCE = 'src-codex'

const fixture = fs
  .readFileSync(path.join(CLI_DIR, 'test/fixtures/codex-0.166.0-attach-approve-turnstart.jsonl'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as Json)
const recorded = (method: string, n = 0) => fixture.filter((m) => m.method === method && m.params)[n]!.params as Json
const APPROVAL = recorded('item/commandExecution/requestApproval')
const THREAD = String(APPROVAL.threadId)
const CWD = String(APPROVAL.cwd)

/** A scriptable stand-in for `codex app-server`: answers our calls, records what we send, pushes what tests say. */
class FakeAppServer {
  readonly received: Json[] = []
  sockets = new Set<WebSocket>()
  loaded: string[] = [THREAD, 'no-rollout-yet']
  resumeStatus: Json = { type: 'active', activeFlags: ['waitingOnApproval'] }
  /** The turn `turn/steer` accepts; any other (or none) fails as codex 0.166 does. */
  activeTurn: string | null = null
  onResume: (ws: WebSocket) => void = () => {}
  private server: http.Server
  private wss: WebSocketServer

  constructor(readonly socket: string) {
    this.server = http.createServer()
    this.wss = new WebSocketServer({ server: this.server })
    this.wss.on('connection', (ws) => {
      this.sockets.add(ws)
      ws.on('close', () => this.sockets.delete(ws))
      ws.on('message', (buf) => this.handle(ws, JSON.parse(buf.toString()) as Json))
    })
  }

  listen(): Promise<void> {
    fs.mkdirSync(path.dirname(this.socket), { recursive: true })
    return new Promise((r) => this.server.listen(this.socket, () => r()))
  }

  close(): Promise<void> {
    for (const ws of this.sockets) ws.terminate()
    return new Promise((r) => this.wss.close(() => this.server.close(() => r())))
  }

  send(msg: Json): void {
    for (const ws of this.sockets) ws.send(JSON.stringify(msg))
  }

  notify(method: string, params: Json): void {
    this.send({ method, params })
  }

  calls(method: string): Json[] {
    return this.received.filter((m) => m.method === method)
  }

  private handle(ws: WebSocket, m: Json): void {
    this.received.push(m)
    const reply = (result: unknown) => ws.send(JSON.stringify({ id: m.id, result }))
    const params = (m.params ?? {}) as Json
    switch (m.method) {
      case 'initialize':
        reply({ userAgent: 'codex-tui/0.166.0 (Ubuntu 24.4.0; x86_64) tmux (agentwatch; 0.1.0)' })
        return
      case 'thread/loaded/list':
        reply({ data: this.loaded })
        return
      case 'thread/resume':
        if (params.threadId !== THREAD) {
          ws.send(JSON.stringify({ id: m.id, error: { code: -32600, message: 'no rollout found' } }))
          return
        }
        reply({
          thread: {
            id: THREAD,
            cwd: CWD,
            preview: 'Write hello.txt containing hi',
            model: 'gpt-5.5-codex',
            ephemeral: false,
            status: this.resumeStatus,
          },
        })
        this.onResume(ws)
        return
      case 'turn/steer':
        if (!this.activeTurn) {
          ws.send(JSON.stringify({ id: m.id, error: { code: -32600, message: 'no active turn to steer' } }))
          return
        }
        reply({ turnId: this.activeTurn })
        return
      case 'turn/start':
      case 'thread/unsubscribe':
        reply({})
        return
      default:
        if (m.id !== undefined && m.method) reply({})
    }
  }
}

let tmp: string
let fake: FakeAppServer
let core: Core
let codex: CodexAdapter
let key: CryptoKey
let sent: SourceMessage[]
let alive: boolean | null

const waitFor = async <T>(what: string, fn: () => T | undefined | false, ms = 5000): Promise<T> => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const v = fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}
const session = () => core.sessions.get(THREAD)
const openRequest = () => [...core.requests.values()].find((r) => r.sessionId === THREAD && r.status === 'open')
const command = async (body: CommandBody, requestId?: string) =>
  core.handleCommand(
    await buildCommand(key, {
      deviceId: 'dev-1',
      sourceId: SOURCE,
      sessionId: THREAD,
      ...(requestId ? { requestId } : {}),
      body,
    }),
  )

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-codex-'))
  fake = new FakeAppServer(path.join(tmp, 'app-server-control', 'app-server-control.sock'))
  fake.onResume = () => fake.send({ id: 0, method: 'item/commandExecution/requestApproval', params: APPROVAL })
  await fake.listen()
  key = await importVaultKey(generateVaultKey())
  sent = []
  alive = true
  core = new Core({
    sourceId: SOURCE,
    key,
    privacy: 'full',
    allowMessages: true,
    doneMinSeconds: 30,
    needsYouDelayMs: 0,
    send: (m) => sent.push(m),
    log: () => {},
    startedAt: Date.now() - 1000,
  })
  codex = new CodexAdapter(core, {
    log: () => {},
    clientVersion: '0.1.0',
    holdMs: 60_000,
    codexHome: tmp,
    pollMs: 50,
    tuiAlive: () => alive,
  })
  core.register(codex)
  codex.start()
})

afterEach(async () => {
  core.stop()
  await fake.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('Codex adapter', () => {
  it('joins a running thread and shows the approval it was already waiting on, with the bare command', async () => {
    const req = await waitFor('approval', openRequest)
    expect(codex.describe()).toBe('codex 0.166.0')
    expect(fake.calls('initialize')[0]!.params).toMatchObject({ capabilities: { experimentalApi: true } })
    expect(fake.calls('thread/resume')[0]!.params).toMatchObject({ threadId: THREAD, excludeTurns: true })
    expect(req.info).toMatchObject({
      title: 'Run a command',
      detail: expect.stringMatching(/^printf hi > hello\.txt\n# May I/),
    })
    expect(session()).toMatchObject({ agent: 'codex', state: 'needs_you', caps: { reply: true } })
    expect(session()!.info).toMatchObject({ project: 'work', title: 'Write hello.txt containing hi' })
  })

  it('a thread with no rollout yet is retried, not joined', async () => {
    await waitFor('approval', openRequest)
    await waitFor(
      'retry',
      () => fake.calls('thread/resume').filter((c) => (c.params as Json).threadId !== THREAD).length,
    )
    expect(core.sessions.has('no-rollout-yet')).toBe(false)
  })

  it('approve on the phone → accept goes to Codex; the turn then finishes with the final answer as the snippet', async () => {
    const req = await waitFor('approval', openRequest)
    await command({ kind: 'decide', behavior: 'allow' }, req.id)
    const answer = await waitFor('accept', () => fake.received.find((m) => m.id === 0 && m.result))
    expect(answer.result).toEqual({ decision: 'accept' })
    fake.notify('serverRequest/resolved', { threadId: THREAD, requestId: 0 })
    fake.notify('thread/status/changed', { threadId: THREAD, status: { type: 'active', activeFlags: [] } })
    fake.notify('item/completed', recorded('item/completed', 3))
    fake.notify('thread/status/changed', { threadId: THREAD, status: { type: 'idle' } })
    fake.notify('turn/completed', recorded('turn/completed'))
    await waitFor('idle', () => session()?.state === 'idle')
    expect(core.requests.get(req.id)?.status).toBe('answered')
    expect(session()!.info.snippet).toBe('Created `hello.txt` containing `hi`.')
  })

  it('a file change shows its diff; one it cannot show is answered at the computer', async () => {
    await waitFor('approval', openRequest)
    const change = (id: string, diff?: string) => {
      fake.notify('item/started', {
        threadId: THREAD,
        item: { type: 'fileChange', id, changes: [{ path: '/elsewhere/a.txt', kind: { type: 'update' }, diff }] },
      })
    }
    const edit = (rpc: number, itemId: string) =>
      fake.send({ id: rpc, method: 'item/fileChange/requestApproval', params: { threadId: THREAD, itemId } })
    change('fc1', '@@ -1 +1 @@\n-old\n+new\n')
    edit(1, 'fc1')
    const shown = await waitFor('file change', () =>
      [...core.requests.values()].find((r) => r.info.tool === 'apply_patch' && r.status === 'open'),
    )
    expect(shown.info.detail).toBe('/elsewhere/a.txt\n@@ -1 +1 @@\n-old\n+new')
    expect(shown.answerable).toBe(true)
    change('fc2')
    edit(2, 'fc2')
    const blind = await waitFor('blind file change', () =>
      [...core.requests.values()].find((r) => r.info.tool === 'apply_patch' && r.id !== shown.id),
    )
    expect(blind.answerable).toBe(false)
  })

  it('deny on the phone → decline', async () => {
    const req = await waitFor('approval', openRequest)
    await command({ kind: 'decide', behavior: 'deny' }, req.id)
    expect((await waitFor('decline', () => fake.received.find((m) => m.id === 0 && m.result))).result).toEqual({
      decision: 'decline',
    })
  })

  it('an approval answered in the TUI closes on the phone as answered at the computer', async () => {
    const req = await waitFor('approval', openRequest)
    fake.notify('serverRequest/resolved', { threadId: THREAD, requestId: 0 })
    await waitFor('closed', () => core.requests.get(req.id)?.status === 'answered_locally')
    await command({ kind: 'decide', behavior: 'allow' }, req.id)
    expect(fake.received.some((m) => m.id === 0 && m.result)).toBe(false)
  })

  it('a phone reply to an idle thread starts a turn; the prompt and answer show up like any other turn', async () => {
    fake.resumeStatus = { type: 'idle' }
    fake.onResume = () => {}
    await waitFor('idle thread', () => session()?.state === 'idle')
    await command({ kind: 'message', text: 'Reply with exactly the word PONG and nothing else.' })
    const start = await waitFor('turn/start', () => fake.calls('turn/start')[0])
    expect(start.params).toEqual({
      threadId: THREAD,
      input: [{ type: 'text', text: 'Reply with exactly the word PONG and nothing else.', text_elements: [] }],
    })
    expect(sent.some((m) => m.t === 'command.ack' && m.status === 'applied')).toBe(true)
    fake.notify('thread/status/changed', { threadId: THREAD, status: { type: 'active', activeFlags: [] } })
    fake.notify('turn/started', recorded('turn/started'))
    fake.notify('item/started', recorded('item/started', 3))
    await waitFor('working', () => session()?.state === 'working')
    fake.notify('item/completed', {
      threadId: THREAD,
      item: { type: 'agentMessage', text: 'PONG', phase: 'final_answer' },
    })
    fake.notify('turn/completed', recorded('turn/completed', 1))
    await waitFor('idle again', () => session()?.state === 'idle' && session()?.info.snippet === 'PONG')
    const events = sent
      .filter((m) => m.t === 'event')
      .map((m) => (m as Extract<SourceMessage, { t: 'event' }>).event.kind)
    expect(events.filter((k) => k === 'prompted')).toHaveLength(1)
  })

  it('a phone reply to a running turn steers into it (codex 0.166), and says so', async () => {
    fake.resumeStatus = { type: 'idle' }
    fake.onResume = () => {}
    await waitFor('idle thread', () => session()?.state === 'idle')
    expect(session()?.caps).toEqual({ reply: true, busyReply: 'steer' })
    const started = recorded('turn/started') as { turn: { id: string } }
    fake.activeTurn = started.turn.id
    fake.notify('turn/started', started)
    await waitFor('working', () => session()?.state === 'working')
    await command({ kind: 'message', text: 'Also add a test for it.' })
    const steer = await waitFor('turn/steer', () => fake.calls('turn/steer')[0])
    expect(steer.params).toEqual({
      threadId: THREAD,
      expectedTurnId: started.turn.id,
      input: [{ type: 'text', text: 'Also add a test for it.', text_elements: [] }],
    })
    await waitFor('ack', () => sent.find((m) => m.t === 'command.ack'))
    expect(sent.find((m) => m.t === 'command.ack')).toMatchObject({
      status: 'applied',
      detail: 'Sent into the running turn',
    })
    expect(fake.calls('turn/start')).toHaveLength(0)
  })

  it('a reply that just missed the turn starts a new one instead', async () => {
    fake.resumeStatus = { type: 'idle' }
    fake.onResume = () => {}
    await waitFor('idle thread', () => session()?.state === 'idle')
    // We saw the turn start, but it ended before the reply got there.
    fake.notify('turn/started', recorded('turn/started'))
    await waitFor('working', () => session()?.state === 'working')
    await command({ kind: 'message', text: 'One more thing.' })
    await waitFor('turn/start', () => fake.calls('turn/start')[0])
    expect(fake.calls('turn/steer')).toHaveLength(1)
    await waitFor('ack', () => sent.find((m) => m.t === 'command.ack'))
    expect(sent.find((m) => m.t === 'command.ack')).toEqual({
      t: 'command.ack',
      commandId: expect.any(String),
      status: 'applied',
    })
  })

  it('maps a request_user_input question to options, and the answer back to question ids', async () => {
    fake.onResume = () =>
      fake.send({
        id: 7,
        method: 'item/tool/requestUserInput',
        params: {
          threadId: THREAD,
          turnId: 't',
          itemId: 'i',
          isBlocking: true,
          autoResolutionMs: null,
          questions: [
            {
              id: 'q1',
              header: 'Ship',
              question: 'Ship it?',
              isOther: false,
              isSecret: false,
              options: [
                { label: 'Yes', description: 'Ship now' },
                { label: 'No', description: 'Wait' },
              ],
            },
          ],
        },
      })
    const req = await waitFor('question', openRequest)
    expect(req).toMatchObject({ kind: 'question', answerable: true })
    expect(req.info.questions?.[0]).toMatchObject({
      question: 'Ship it?',
      options: [{ label: 'Yes' }, { label: 'No' }],
    })
    await command({ kind: 'answer', answers: { 'Ship it?': 'No' } }, req.id)
    const r = await waitFor('answer', () => fake.received.find((m) => m.id === 7 && m.result))
    expect(r.result).toEqual({ answers: { q1: { answers: ['No'] } } })
  })

  it('leaves requests it does not understand to the TUI', async () => {
    fake.onResume = () =>
      fake.send({ id: 9, method: 'account/chatgptAuthTokens/refresh', params: { threadId: THREAD } })
    await waitFor('joined', () => session())
    await new Promise((r) => setTimeout(r, 150))
    expect(openRequest()).toBeUndefined()
    expect(fake.received.some((m) => m.id === 9)).toBe(false)
  })

  it('ends the session once no Codex TUI runs in its folder, and lets go of the thread', async () => {
    await waitFor('joined', () => session())
    alive = false
    const live = codex as unknown as { checkLiveness(): void }
    live.checkLiveness()
    expect(session()?.state).not.toBe('ended')
    live.checkLiveness()
    expect(session()?.state).toBe('ended')
    await waitFor('unsubscribe', () => fake.calls('thread/unsubscribe')[0])
    // Still loaded on the server, but not joined again while no TUI runs there.
    const resumes = fake.calls('thread/resume').filter((c) => (c.params as Json).threadId === THREAD).length
    await new Promise((r) => setTimeout(r, 200))
    expect(fake.calls('thread/resume').filter((c) => (c.params as Json).threadId === THREAD)).toHaveLength(resumes)
  })

  it('survives the app-server restarting (it auto-updates): requests expire, then the thread is joined again', async () => {
    const req = await waitFor('approval', openRequest)
    for (const ws of fake.sockets) ws.terminate()
    await waitFor('expired', () => core.requests.get(req.id)?.status === 'expired')
    expect(session()?.caps).toMatchObject({ reply: false })
    await waitFor('rejoined', () => openRequest() && openRequest()!.id !== req.id, 8000)
    expect(session()?.caps).toEqual({ reply: true, busyReply: 'steer' })
  }, 15_000)
})

describe('Codex helpers', () => {
  it('shows the command inside a shell wrapper', () => {
    expect(unwrapShell("/bin/bash -lc 'printf hi > hello.txt'")).toBe('printf hi > hello.txt')
    expect(unwrapShell(`bash -lc 'echo '\\''quoted'\\'''`)).toBe("echo 'quoted'")
    expect(unwrapShell('ls -la')).toBe('ls -la')
  })

  it('finds a Codex TUI by working directory in /proc, and ignores the app-server', () => {
    const proc = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-proc-'))
    const fakeProc = (pid: string, cwd: string, argv: string[]) => {
      fs.mkdirSync(path.join(proc, pid))
      fs.symlinkSync(cwd, path.join(proc, pid, 'cwd'))
      fs.writeFileSync(path.join(proc, pid, 'cmdline'), `${argv.join('\0')}\0`)
    }
    fakeProc('10', '/w/a', ['/home/dev/.codex/bin/codex', 'app-server', '--listen', 'unix://'])
    fakeProc('11', '/w/b', ['node', '/usr/lib/node_modules/@openai/codex/bin/codex.js'])
    fakeProc('12', '/w/c', ['/usr/local/bin/codex', '-m', 'gpt-5.5'])
    expect(codexTuiAlive('/w/a', proc)).toBe(false)
    expect(codexTuiAlive('/w/b', proc)).toBe(true)
    expect(codexTuiAlive('/w/c', proc)).toBe(true)
    expect(codexTuiAlive('/w/d', proc)).toBe(false)
    expect(codexTuiAlive('/w/a', path.join(proc, 'missing'))).toBeNull()
    fs.rmSync(proc, { recursive: true, force: true })
  })
})
