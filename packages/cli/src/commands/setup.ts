// `agentwatch setup`: connect this OS user to a relay and install everything it needs. On the first machine it claims
// the relay with the deploy-time claim secret and creates a fresh vault key. Run it again at any time: it keeps the
// config, refreshes the installed bundle and the Claude Code plugin, and restarts the daemon.

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { generateVaultKey } from '@agentwatch/protocol'
import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { Config, loadConfig, saveConfig } from '../config.ts'
import { socketAlive } from '../daemon/main.ts'
import { type InstallReport, install, MIN_NODE_MAJOR, pickNode } from '../install.ts'
import { type Paths, paths } from '../paths.ts'

export const INSTALL_FLAGS = {
  privacy: { type: 'string' },
  'no-messages': { type: 'boolean', default: false },
  messages: { type: 'boolean', default: false },
  'no-claude': { type: 'boolean', default: false },
  node: { type: 'string' },
  force: { type: 'boolean', default: false },
} as const

export async function setup(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { ...INSTALL_FLAGS, relay: { type: 'string' }, 'claim-secret': { type: 'string' } },
  })
  if (!nodeOk()) return 1
  const p = paths()
  const existing = loadConfig(p.configFile)
  const relayUrl = values.relay?.replace(/\/+$/, '')
  let cfg: Config

  if (existing && !values.force) {
    if (relayUrl && relayUrl !== existing.relayUrl) {
      console.error(`This user is already connected to ${existing.relayUrl}.`)
      console.error('Use --force to connect it to a different relay instead (phones will need pairing again).')
      return 1
    }
    cfg = existing
  } else {
    const claimSecret = values['claim-secret'] ?? process.env.AGENTWATCH_CLAIM_SECRET
    if (!relayUrl || !claimSecret) {
      console.error('Usage: agentwatch setup --relay https://<your-relay> --claim-secret <secret>')
      console.error(
        '       (no relay yet? `agentwatch relay deploy`; adding a second OS user or computer? `agentwatch join`)',
      )
      return 64
    }
    const claimed = await claimRelay(relayUrl, claimSecret)
    if (!claimed) return 1
    cfg = Config.parse({ relayUrl, ...claimed, vaultKey: generateVaultKey() })
  }
  const flags = applyFlags(cfg, values)
  if (!flags) return 64
  return finishSetup(p, flags, values, existing)
}

function nodeOk(): boolean {
  const major = Number(process.versions.node.split('.')[0])
  if (major >= MIN_NODE_MAJOR) return true
  console.error(`AgentWatch needs Node ${MIN_NODE_MAJOR} or newer; this is ${process.versions.node}.`)
  return false
}

export async function claimRelay(
  relayUrl: string,
  claimSecret: string,
): Promise<{ sourceId: string; sourceToken: string } | null> {
  let res: Response
  try {
    res = await fetch(`${relayUrl}/api/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claimSecret }),
    })
  } catch (e) {
    console.error(`Could not reach ${relayUrl}: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }
  const body = (await res.json().catch(() => ({}))) as { sourceId?: string; sourceToken?: string; error?: string }
  if (!res.ok || !body.sourceId || !body.sourceToken) {
    console.error(
      res.status === 409
        ? 'That relay is already claimed. To add this user or computer to it, run `agentwatch invite` where it is set up, then `agentwatch join` here.'
        : `The relay refused the claim: ${body.error ?? `HTTP ${res.status}`}`,
    )
    return null
  }
  return { sourceId: body.sourceId, sourceToken: body.sourceToken }
}

type Flags = { privacy?: string; 'no-messages'?: boolean; messages?: boolean }

/** Apply --privacy / --no-messages / --messages to a config. Flags left out keep what the config has. */
export function applyFlags(cfg: Config, v: Flags): Config | null {
  if (v.privacy !== undefined && v.privacy !== 'full' && v.privacy !== 'summary') {
    console.error('--privacy must be "full" or "summary"')
    return null
  }
  return {
    ...cfg,
    ...(v.privacy ? { privacy: v.privacy as Config['privacy'] } : {}),
    ...(v['no-messages'] ? { allowMessages: false } : v.messages ? { allowMessages: true } : {}),
  }
}

/** Shared by setup, join and relay deploy: save the config, install, restart the daemon and report. */
export async function finishSetup(
  p: Paths,
  cfg: Config,
  values: { 'no-claude'?: boolean; node?: string },
  previous: Config | null,
): Promise<number> {
  if (JSON.stringify(cfg) !== JSON.stringify(previous)) {
    saveConfig(cfg, p.configFile)
    console.log(`✓ Saved ${tilde(p.configFile)} (mode 0600, holds this user's key)`)
  }
  const home = process.env.HOME || os.homedir()
  const node = values.node ?? pickNode(home, process.env, process.execPath)
  const bundleDir = path.dirname(fileURLToPath(import.meta.url))
  let report: InstallReport
  try {
    report = install({
      paths: p,
      home,
      env: process.env,
      bundleDir,
      node,
      claude: !values['no-claude'],
    })
  } catch (e) {
    console.error(`Install failed: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  console.log(`✓ Installed AgentWatch ${report.version} in ${tilde(p.installDir)}`)
  console.log(`    hooks run ${tilde(report.launcher)} with Node ${tilde(report.node)}`)
  if (report.command.linked) {
    console.log(`✓ Command ${tilde(report.command.path)}`)
    if (!report.command.onPath) console.log(`    ! ${tilde(path.dirname(report.command.path))} is not on your PATH yet`)
  } else if (report.command.detail) console.log(`! ${report.command.detail}`)
  printClaude(report)
  if (report.codexVersion) console.log(`· Codex ${report.codexVersion} found (Codex support is on its way)`)
  for (const b of report.backups) console.log(`    backed up ${tilde(b)}`)

  // Restart the daemon from the installed copy so it runs the new code and config.
  if (await socketAlive(p.socket)) await call('POST', '/v1/shutdown').catch(() => {})
  for (let i = 0; i < 30 && (await socketAlive(p.socket)); i++) await new Promise((r) => setTimeout(r, 100))
  const entry = path.join(p.installDir, 'current', 'agentwatch.mjs')
  const up = (await ensureDaemon(p, 5000, { node, entry })) && (await waitForRelay(10_000))
  if (up) console.log(`✓ Daemon running, connected to ${new URL(cfg.relayUrl).host} (privacy: ${cfg.privacy})`)
  else console.log('! Saved and installed, but the daemon could not reach the relay yet. Run `agentwatch doctor`.')
  if (!previous || previous.vaultKey !== cfg.vaultKey) console.log('\nNext: `agentwatch pair` to add your phone.')
  return up ? 0 : 1
}

function printClaude(r: InstallReport): void {
  const c = r.claude
  const v = c.claudeVersion ? `Claude Code ${c.claudeVersion}` : 'Claude Code'
  switch (c.status) {
    case 'installed':
    case 'updated':
    case 'enabled':
      console.log(`✓ ${v}: AgentWatch plugin ${c.status}. Restart running Claude sessions to load it.`)
      break
    case 'unchanged':
      console.log(`✓ ${v}: AgentWatch plugin up to date`)
      break
    case 'skipped':
      console.log(`· ${c.detail ?? 'Claude Code plugin skipped'}`)
      break
    case 'failed':
      console.log(`! ${v}: ${c.detail}`)
      console.log('    In Claude Code you can also run: /plugin marketplace add ~/.local/share/agentwatch/marketplace')
      break
  }
}

export function tilde(p: string): string {
  const home = os.homedir()
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p
}
