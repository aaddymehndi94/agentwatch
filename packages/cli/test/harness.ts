// E2E harness: a real relay (workerd via wrangler's unstable_dev), the real bundled CLI/daemon/hook as subprocesses
// in a throwaway AGENTWATCH_HOME, and a fake phone that pairs and talks to the relay over HTTP like the app does.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  type Binding,
  buildCommand,
  type CommandBody,
  importVaultKey,
  open,
  parsePairingCode,
  randomId,
  type StateView,
  unwrapVaultKey,
} from '@agentwatch/protocol'
import { call } from '../src/client.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
export const CLI_DIR = path.resolve(here, '..')
export const RELAY_DIR = path.resolve(CLI_DIR, '../relay')
export const BIN = path.join(CLI_DIR, 'dist/agentwatch.mjs')
export const HOOK = path.join(CLI_DIR, 'dist/hook.mjs')

export function buildCli(): void {
  execFileSync(process.execPath, ['build.mjs'], { cwd: CLI_DIR, stdio: 'pipe' })
}

export interface Relay {
  url: string
  claimSecret: string
  stop: () => Promise<void>
}

export async function startRelay(): Promise<Relay> {
  const require = createRequire(path.join(RELAY_DIR, 'package.json'))
  // wrangler is the relay package's dev dependency; load it from there.
  const wrangler = (await import(pathToFileURL(require.resolve('wrangler')).href)) as {
    unstable_dev: (
      script: string,
      options: Record<string, unknown>,
    ) => Promise<{ address: string; port: number; stop: () => Promise<void> }>
  }
  const claimSecret = randomId(24)
  const persistTo = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-relay-'))
  const worker = await wrangler.unstable_dev(path.join(RELAY_DIR, 'src/index.ts'), {
    config: path.join(RELAY_DIR, 'wrangler.jsonc'),
    vars: { CLAIM_SECRET: claimSecret },
    ip: '127.0.0.1',
    local: true,
    persistTo,
    logLevel: 'error',
    experimental: { disableExperimentalWarning: true, disableDevRegistry: true },
  })
  return {
    url: `http://${worker.address}:${worker.port}`,
    claimSecret,
    stop: async () => {
      await worker.stop()
      fs.rmSync(persistTo, { recursive: true, force: true })
    },
  }
}

export function tempHome(): string {
  // Short path: unix socket paths are limited to ~107 bytes.
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aw-'))
}

export function env(home: string): NodeJS.ProcessEnv {
  return { ...process.env, AGENTWATCH_HOME: home, AGENTWATCH_DEBUG: '1' }
}

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  ms: number
}

export function run(file: string, args: string[], home: string, stdin = ''): Promise<RunResult> {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [file, ...args], { env: env(home), stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }))
    child.stdin.end(stdin)
  })
}

/** Run the hook client the way Claude Code does: payload on stdin, read stdout. */
export function hook(home: string, payload: unknown): Promise<RunResult> {
  return run(HOOK, ['claude'], home, JSON.stringify(payload))
}

export function socketOf(home: string): string {
  return path.join(home, 'state', 'agentwatchd.sock')
}

export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 10_000,
): Promise<T> {
  const until = Date.now() + timeoutMs
  let last: unknown
  while (Date.now() < until) {
    try {
      const v = await fn()
      if (v) return v
    } catch (e) {
      last = e
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${String(last)}` : ''}`)
}

/** A fake phone: pairs through the daemon + relay exactly like the app, then reads state and sends commands. */
export class FakeDevice {
  private constructor(
    readonly relayUrl: string,
    readonly deviceId: string,
    private token: string,
    readonly key: CryptoKey,
  ) {}

  static async pair(relayUrl: string, home: string): Promise<FakeDevice> {
    const r = await call<{ code: string; link: string }>(
      'POST',
      '/v1/pair',
      { kind: 'device' },
      { socket: socketOf(home) },
    )
    if (r.status !== 200) throw new Error(`pair failed: ${JSON.stringify(r.body)}`)
    const secret = parsePairingCode(r.body.code)
    const res = await fetch(`${relayUrl}/api/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairId: secret.pairId, name: 'Test phone' }),
    })
    if (!res.ok) throw new Error(`claim failed: ${res.status} ${await res.text()}`)
    const body = (await res.json()) as { deviceId: string; deviceToken: string; wrapped: string }
    const key = await importVaultKey(await unwrapVaultKey(body.wrapped, secret))
    return new FakeDevice(relayUrl, body.deviceId, body.deviceToken, key)
  }

  async get<T>(p: string): Promise<{ status: number; body: T }> {
    const res = await fetch(`${this.relayUrl}${p}`, { headers: { authorization: `Bearer ${this.token}` } })
    return { status: res.status, body: (await res.json()) as T }
  }

  async state(): Promise<StateView> {
    const r = await this.get<StateView>('/api/state')
    if (r.status !== 200) throw new Error(`state: ${r.status}`)
    return r.body
  }

  open<T>(sealed: string | undefined, binding: Binding): Promise<T> {
    if (!sealed) throw new Error('nothing sealed')
    return open<T>(this.key, sealed, binding)
  }

  async command(args: { sourceId: string; sessionId: string; requestId?: string; body: CommandBody }) {
    const env = await buildCommand(this.key, { deviceId: this.deviceId, ...args })
    const res = await fetch(`${this.relayUrl}/api/commands`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(env),
    })
    if (res.status !== 202) throw new Error(`command: ${res.status} ${await res.text()}`)
    return env.commandId
  }

  async commandStatus(id: string): Promise<{ status: string; detail?: string | null }> {
    return (await this.get<{ status: string; detail?: string | null }>(`/api/commands/${id}`)).body
  }
}

export function loadClaudeFixture(): Record<string, unknown>[] {
  return JSON.parse(fs.readFileSync(path.join(CLI_DIR, 'test/fixtures/claude-2.1.322-session.json'), 'utf8'))
}
