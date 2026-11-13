// `agentwatch daemon`: one per OS user, started on demand by the first hook (or by a service unit where available).
// Single instance via a live-socket check plus an O_EXCL lock file; listens on a unix socket in a 0700 directory.

import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {
  formatPairingCode,
  generateVaultKey,
  importVaultKey,
  newPairingSecret,
  type RelayMessage,
  type Session,
  type SourceMessage,
  wrapVaultKey,
} from '@agentwatch/protocol'
import { z } from 'zod'
import { ClaudeAdapter } from '../adapters/claude.ts'
import { CodexAdapter } from '../adapters/codex.ts'
import { AskArgs, AskRefused, EmitArgs, GenericAdapter } from '../adapters/generic.ts'
import { type Config, loadConfig, saveConfig } from '../config.ts'
import { fileLogger, type Logger } from '../log.ts'
import { type Paths, paths } from '../paths.ts'
import { VERSION } from '../version.ts'
import { Core } from './core.ts'
import { RelayLink } from './relay.ts'
import { createLocalServer, type Handler } from './server.ts'

const PAIRING_TTL_MS = 10 * 60_000

export interface DaemonHandle {
  core: Core
  relay: RelayLink
  stop: () => Promise<void>
}

function isSessionLike(v: unknown): v is Session {
  const s = v as Session
  return (
    typeof s === 'object' &&
    s !== null &&
    typeof s.id === 'string' &&
    typeof s.agent === 'string' &&
    typeof s.state === 'string' &&
    typeof s.updatedAt === 'number' &&
    typeof s.info === 'object'
  )
}

/** Is a daemon already answering on this socket? */
export function socketAlive(socket: string, timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socket)
    const t = setTimeout(() => {
      c.destroy()
      resolve(false)
    }, timeoutMs)
    c.on('connect', () => {
      clearTimeout(t)
      c.end()
      resolve(true)
    })
    c.on('error', () => {
      clearTimeout(t)
      resolve(false)
    })
  })
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Take the lock file, replacing a stale one. Returns false if another live daemon holds it. */
function acquireLock(file: string): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600)
      fs.writeSync(fd, String(process.pid))
      fs.closeSync(fd)
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      let pid = 0
      let age = Number.POSITIVE_INFINITY
      try {
        pid = Number(fs.readFileSync(file, 'utf8').trim())
        age = Date.now() - fs.statSync(file).mtimeMs
      } catch {}
      // A live holder that is still starting up (no socket yet) wins; anything else is stale.
      if (pid && pid !== process.pid && pidAlive(pid) && age < 15_000) return false
      fs.rmSync(file, { force: true })
    }
  }
  return false
}

function ownsLock(file: string): boolean {
  try {
    return Number(fs.readFileSync(file, 'utf8').trim()) === process.pid
  } catch {
    return false
  }
}

export interface StartOptions {
  paths?: Paths
  config?: Config
  log?: Logger
  foreground?: boolean
  /** Exit the process after `POST /v1/shutdown` (the real daemon; tests run it in-process). */
  exitOnShutdown?: boolean
}

/** Start the daemon. Resolves with a handle once it is listening, or null if another daemon is running. */
export async function startDaemon(opts: StartOptions = {}): Promise<DaemonHandle | null> {
  const p = opts.paths ?? paths()
  fs.mkdirSync(p.stateDir, { recursive: true, mode: 0o700 })
  fs.chmodSync(p.stateDir, 0o700)
  const log = opts.log ?? fileLogger(p.logFile, !!opts.foreground)
  const cfg = opts.config ?? loadConfig(p.configFile)
  if (!cfg) {
    log('error', 'AgentWatch is not set up for this user yet. Run `agentwatch setup`.')
    return null
  }
  if (await socketAlive(p.socket)) {
    log('debug', 'daemon already running')
    return null
  }
  if (!acquireLock(p.lockFile)) return null
  // Lose a start race gracefully: whoever's pid is in the lock after a beat is the daemon.
  await new Promise((r) => setTimeout(r, 50))
  if (!ownsLock(p.lockFile)) return null

  const key = await importVaultKey(cfg.vaultKey)
  const startedAt = Date.now()
  const sessionsFile = path.join(p.stateDir, 'sessions.json')
  let saveTimer: NodeJS.Timeout | null = null
  const saveNow = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    try {
      const tmp = `${sessionsFile}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, sessions: core.exportSessions() }), { mode: 0o600 })
      fs.renameSync(tmp, sessionsFile)
    } catch (e) {
      log('warn', 'could not save sessions', { error: String(e) })
    }
  }
  let mute: number | null = null
  // Assigned after Core, whose sender forwards to it.
  let relay: RelayLink
  const core = new Core({
    sourceId: cfg.sourceId,
    key,
    privacy: cfg.privacy,
    allowMessages: cfg.allowMessages,
    doneMinSeconds: cfg.notify.doneMinSeconds,
    needsYouDelayMs: cfg.notify.needsYouDelaySeconds * 1000,
    limitPercent: cfg.notify.limitPercent,
    send: (m: SourceMessage) => relay.send(m),
    log,
    startedAt,
    onChange: () => {
      saveTimer ??= setTimeout(saveNow, 1000)
    },
  })
  try {
    const saved = JSON.parse(fs.readFileSync(sessionsFile, 'utf8')) as { v?: number; sessions?: Session[] }
    if (saved.v === 1 && Array.isArray(saved.sessions)) core.restoreSessions(saved.sessions.filter(isSessionLike))
  } catch {}
  const claude = new ClaudeAdapter(core, { holdMs: cfg.claude.holdSeconds * 1000, log })
  if (cfg.claude.enabled) core.register(claude)
  const codex = new CodexAdapter(core, {
    log,
    clientVersion: VERSION,
    holdMs: cfg.codex.holdSeconds * 1000,
    onDescribe: () => relay?.resendHello(),
  })
  if (cfg.codex.enabled) core.register(codex)
  const generic = new GenericAdapter(core, { log })
  core.register(generic)

  relay = new RelayLink({
    relayUrl: cfg.relayUrl,
    sourceToken: cfg.sourceToken,
    log,
    hello: () => ({
      t: 'hello',
      v: 1,
      host: os.hostname(),
      user: os.userInfo().username,
      privacy: cfg.privacy,
      allowMessages: cfg.allowMessages,
      daemonVersion: VERSION,
      adapters: Object.fromEntries([...core.adapters.values()].map((a) => [a.agent, a.describe()])),
    }),
    snapshot: () => core.snapshot(),
    onMessage: (msg: RelayMessage) => {
      switch (msg.t) {
        case 'command':
          core.handleCommand(msg.command).catch((e) => log('error', 'command failed', { error: String(e) }))
          break
        case 'welcome':
        case 'settings':
          mute = msg.mute
          break
        case 'error':
          log('warn', 'relay error', { error: msg.error })
          break
      }
    },
  })

  const handler: Handler = async ({ method, path, query, body, signal }) => {
    if (method === 'POST' && path.startsWith('/v1/hook/')) {
      const agent = path.slice('/v1/hook/'.length)
      if (agent !== 'claude') return { status: 404, body: { error: `unknown agent ${agent}` } }
      if (!cfg.claude.enabled) return { status: 204 }
      const out = await claude.onHook((body ?? {}) as Record<string, unknown>, signal)
      return out ? { status: 200, text: out } : { status: 204 }
    }
    if (method === 'GET' && path === '/v1/status') {
      return {
        status: 200,
        body: {
          version: VERSION,
          pid: process.pid,
          startedAt,
          user: os.userInfo().username,
          host: os.hostname(),
          sourceId: cfg.sourceId,
          privacy: cfg.privacy,
          allowMessages: cfg.allowMessages,
          mute,
          relay: {
            url: cfg.relayUrl,
            connected: relay.connected,
            lastConnectedAt: relay.lastConnectedAt || null,
            lastError: relay.lastError || null,
          },
          adapters: [...core.adapters.values()].map((a) => a.describe()),
          sessions: [...core.sessions.values()].map((s) => ({
            id: s.id,
            agent: s.agent,
            state: s.state,
            stateSince: s.stateSince,
            project: s.info.project,
            title: s.info.title,
          })),
          requests: [...core.requests.values()]
            .filter((r) => r.status === 'open')
            .map((r) => ({
              id: r.id,
              sessionId: r.sessionId,
              kind: r.kind,
              title: r.info.title,
              createdAt: r.createdAt,
            })),
        },
      }
    }
    if (method === 'POST' && path === '/v1/pair') {
      const args = z
        .object({
          kind: z.enum(['device', 'source']).default('device'),
          meta: z.record(z.string(), z.string()).optional(),
        })
        .parse(body ?? {})
      if (!relay.connected) return { status: 503, body: { error: relay.lastError || 'not connected to the relay yet' } }
      const secret = newPairingSecret()
      const expiresAt = Date.now() + PAIRING_TTL_MS
      const ack = await relay.request({
        t: 'pair.create',
        pairId: secret.pairId,
        kind: args.kind,
        wrapped: await wrapVaultKey(cfg.vaultKey, secret),
        expiresAt,
        ...(args.meta ? { meta: args.meta } : {}),
      })
      if (!ack.ok) return { status: 502, body: { error: ack.error ?? 'the relay did not accept the pairing' } }
      const code = formatPairingCode(secret)
      const link = `${cfg.relayUrl.replace(/\/+$/, '')}/#/pair/${code}`
      return { status: 200, body: { code, link, expiresAt } }
    }
    if (path === '/v1/bridge/claude' && method === 'GET') {
      if (!cfg.claude.enabled) return { status: 404, body: { error: 'Claude is turned off in the AgentWatch config' } }
      const session = query.get('session') ?? ''
      const loop = query.get('loop') ?? ''
      if (!session || !loop) return { status: 400, body: { error: 'session and loop are required' } }
      // v=2 mods ack a reply as queued while Claude works, so they can take one then.
      const r = await claude.bridge.poll(session, loop, signal, { queues: Number(query.get('v') ?? '1') >= 2 })
      if (r === 'superseded') return { status: 410, body: { error: 'a newer bridge took over this session' } }
      return r.length ? { status: 200, body: { messages: r } } : { status: 204 }
    }
    if (path === '/v1/bridge/claude/ack' && method === 'POST') {
      const a = z
        .object({
          session: z.string(),
          id: z.string(),
          ok: z.boolean(),
          error: z.string().max(500).optional(),
          queued: z.boolean().optional(),
        })
        .parse(body ?? {})
      return { status: claude.bridge.ack(a.session, a.id, a.ok, a.error, a.queued) ? 200 : 404, body: {} }
    }
    if (path === '/v1/bridge/claude/usage' && method === 'POST') {
      // The mod's `$.session.usage()`: the account's rate limits, and this session's context fill and cost.
      const a = z.object({ session: z.string().min(1), usage: z.unknown() }).safeParse(body ?? {})
      if (!a.success) return { status: 400, body: { error: 'session and usage are required' } }
      claude.onUsage(a.data.session, a.data.usage)
      return { status: 200, body: {} }
    }
    if (method === 'POST' && path === '/v1/emit') {
      const a = EmitArgs.safeParse(body ?? {})
      if (!a.success) return { status: 400, body: { error: a.error.issues.map((i) => i.message).join('; ') } }
      return { status: 200, body: generic.emit(a.data) }
    }
    if (method === 'POST' && path === '/v1/ask') {
      const a = AskArgs.safeParse(body ?? {})
      if (!a.success) return { status: 400, body: { error: a.error.issues.map((i) => i.message).join('; ') } }
      try {
        return { status: 200, body: await generic.ask(a.data, signal) }
      } catch (e) {
        if (e instanceof AskRefused) return { status: 403, body: { error: e.message } }
        throw e
      }
    }
    if (method === 'POST' && path === '/v1/test-push') {
      if (!relay.connected) return { status: 503, body: { error: relay.lastError || 'not connected to the relay' } }
      const ack = await relay.request(await core.testPush(`${os.userInfo().username}@${os.hostname()}`))
      return { status: ack.ok ? 200 : 502, body: ack }
    }
    if (method === 'POST' && path === '/v1/mute') {
      const { until } = z.object({ until: z.number().int().nonnegative().nullable() }).parse(body ?? {})
      if (!relay.connected) return { status: 503, body: { error: relay.lastError || 'not connected to the relay' } }
      relay.send({ t: 'mute', until })
      mute = until && until > Date.now() ? until : null
      return { status: 200, body: { mute } }
    }
    if (method === 'POST' && path === '/v1/rotate') {
      if (!relay.connected) return { status: 503, body: { error: relay.lastError || 'not connected to the relay' } }
      const onDisk = loadConfig(p.configFile)
      if (onDisk && onDisk.sourceId !== cfg.sourceId)
        return { status: 409, body: { error: 'the config changed under the daemon; run `agentwatch stop` and retry' } }
      // Relay first: if it refuses, nothing changed. If we die after it agreed, re-running rotate finishes the job.
      const vaultKey = generateVaultKey()
      const key = await importVaultKey(vaultKey)
      const ack = await relay.request({ t: 'rotate' })
      if (!ack.ok) return { status: 502, body: { error: ack.error ?? 'the relay did not rotate' } }
      saveConfig({ ...(onDisk ?? cfg), vaultKey }, p.configFile)
      cfg.vaultKey = vaultKey
      core.setKey(key)
      // Reconnect: hello + a snapshot sealed with the new key. Answer once that is under way, so a `pair` right after
      // doesn't race the old socket closing.
      const before = relay.lastConnectedAt
      relay.kick()
      for (let i = 0; i < 100 && relay.lastConnectedAt === before; i++) await new Promise((r) => setTimeout(r, 100))
      log('info', 'vault key rotated')
      return { status: 200, body: { ok: true } }
    }
    if (method === 'POST' && path === '/v1/shutdown') {
      setTimeout(() => void stop().then(() => opts.exitOnShutdown && process.exit(0)), 10)
      return { status: 200, body: { ok: true } }
    }
    return { status: 404, body: { error: 'not found' } }
  }

  const server = createLocalServer(handler, log)
  fs.rmSync(p.socket, { force: true })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(p.socket, () => {
      server.off('error', reject)
      resolve()
    })
  })
  fs.chmodSync(p.socket, 0o600)
  relay.start()
  if (cfg.codex.enabled) codex.start()
  log('info', 'daemon started', { version: VERSION, pid: process.pid, relay: cfg.relayUrl })

  let stopping: Promise<void> | null = null
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      log('info', 'daemon stopping')
      core.stop()
      await core.flushed()
      saveNow()
      relay.stop()
      await new Promise<void>((r) => {
        server.close(() => r())
        server.closeAllConnections()
      })
      if (ownsLock(p.lockFile)) fs.rmSync(p.lockFile, { force: true })
      fs.rmSync(p.socket, { force: true })
    })()
    return stopping
  }
  return { core, relay, stop }
}

/** Entry for `agentwatch daemon`: run until signalled. */
export async function runDaemon(foreground: boolean): Promise<number> {
  const handle = await startDaemon({ foreground, exitOnShutdown: true })
  if (!handle) return 0
  const quit = () => {
    handle.stop().finally(() => process.exit(0))
  }
  process.on('SIGTERM', quit)
  process.on('SIGINT', quit)
  process.on('SIGHUP', quit)
  // Crash rather than limp on: held hooks then fall back to the terminal dialog, and the next hook restarts us.
  process.on('uncaughtException', (e) => {
    fileLogger(paths().logFile)('error', 'uncaught exception', { error: String(e?.stack ?? e) })
    process.exit(1)
  })
  return await new Promise<number>(() => {})
}
