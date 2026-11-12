// `agentwatch doctor [--test-push]`: check every link in the chain, from this OS user to the phone, and say what to fix.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { loadConfig } from '../config.ts'
import { paths } from '../paths.ts'

type Level = 'ok' | 'warn' | 'fail'
const MARK: Record<Level, string> = { ok: '✓', warn: '!', fail: '✗' }

interface Check {
  level: Level
  what: string
  detail?: string
}

export async function doctor(args: string[]): Promise<number> {
  const checks: Check[] = []
  const add = (level: Level, what: string, detail?: string) => {
    checks.push({ level, what, ...(detail ? { detail } : {}) })
    if (!args.includes('--json')) console.log(`${MARK[level]} ${what}${detail ? `\n    ${detail}` : ''}`)
  }
  const p = paths()

  const major = Number(process.versions.node.split('.')[0])
  if (major >= 22) add('ok', `Node ${process.versions.node}`)
  else add('fail', `Node ${process.versions.node} is too old`, 'AgentWatch needs Node 22 or newer.')

  const cfg = loadConfig(p.configFile)
  if (!cfg) {
    add('fail', 'Not set up for this OS user', 'Run `agentwatch setup` (first machine) or `agentwatch join`.')
    return finish(checks, args)
  }
  const mode = fs.statSync(p.configFile).mode & 0o777
  if (mode & 0o077) add('warn', `Config is readable by others (${mode.toString(8)})`, `Run: chmod 600 ${p.configFile}`)
  else add('ok', `Config ${tilde(p.configFile)}`, `privacy ${cfg.privacy}, replies ${cfg.allowMessages ? 'on' : 'off'}`)

  try {
    const st = fs.statSync(p.stateDir).mode & 0o777
    if (st & 0o077)
      add('fail', `State folder is open to other users (${st.toString(8)})`, `Run: chmod 700 ${p.stateDir}`)
    else add('ok', `Daemon socket folder is private (${tilde(p.stateDir)})`)
  } catch {}

  const launcher = path.join(p.installDir, 'hook')
  if (isExecutable(launcher)) add('ok', `Hook launcher ${tilde(launcher)}`)
  else
    add(
      'warn',
      'No hook launcher installed',
      `Agents can only reach the daemon through ${tilde(launcher)}. Run \`agentwatch setup\` again to install it.`,
    )
  const plugin = claudePluginState()
  if (plugin === 'enabled') add('ok', 'Claude Code plugin enabled')
  else if (plugin === 'no-claude') add('ok', 'Claude Code not found for this user (skipped)')
  else
    add(
      'warn',
      'Claude Code plugin not enabled',
      'Run `agentwatch setup` again, or in Claude Code: /plugin install agentwatch. Then restart Claude sessions.',
    )

  if (!(await ensureDaemon(p))) {
    add('fail', 'Daemon did not start', `See the log: ${tilde(p.logFile)}`)
    return finish(checks, args)
  }
  add('ok', 'Daemon running')

  if (!(await waitForRelay())) {
    const s = await call<{ relay: { url: string; lastError: string | null } }>('GET', '/v1/status').catch(() => null)
    add(
      'fail',
      `Cannot reach the relay at ${cfg.relayUrl}`,
      s?.body.relay.lastError ?? 'Check your network, and that the relay is deployed.',
    )
    return finish(checks, args)
  }
  add('ok', `Relay connected (${new URL(cfg.relayUrl).host})`)

  if (args.includes('--test-push')) {
    const r = await call<{ ok: boolean; error?: string }>('POST', '/v1/test-push', {}, { timeoutMs: 20_000 })
    if (r.body.ok) add('ok', 'Test notification sent', 'It should arrive on every paired phone within a few seconds.')
    else
      add(
        'fail',
        'Test notification not delivered',
        r.body.error === 'no phone has notifications on'
          ? 'No paired phone has notifications on. Run `agentwatch pair`, or turn them on in the app’s Settings.'
          : r.body.error,
      )
  } else {
    console.log(
      args.includes('--json') ? '' : '\nRun `agentwatch doctor --test-push` to send a notification to your phones.',
    )
  }
  return finish(checks, args)
}

function finish(checks: Check[], args: string[]): number {
  if (args.includes('--json')) console.log(JSON.stringify({ checks }, null, 2))
  return checks.some((c) => c.level === 'fail') ? 1 : 0
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function tilde(p: string): string {
  const home = os.homedir()
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p
}

/** Reads Claude Code's user settings; the plugin counts as enabled when any `agentwatch@…` entry is true. */
function claudePluginState(): 'enabled' | 'disabled' | 'no-claude' {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')
  if (!fs.existsSync(dir)) return 'no-claude'
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) as {
      enabledPlugins?: Record<string, boolean>
    }
    return Object.entries(s.enabledPlugins ?? {}).some(([k, v]) => v && k.split('@')[0] === 'agentwatch')
      ? 'enabled'
      : 'disabled'
  } catch {
    return 'disabled'
  }
}
