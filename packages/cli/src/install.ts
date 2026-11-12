// Installing AgentWatch for this OS user: the CLI bundle, the hook launcher, the `agentwatch` command and the Claude
// Code plugin (through a local marketplace). Everything lives in this user's home and nothing needs root. Every step is
// idempotent, and a settings file that isn't ours is backed up before anything changes it.
//
//   <installDir>/versions/<v>/      agentwatch.mjs, hook.mjs, plugin/   (one per installed version)
//   <installDir>/current            → versions/<v>   (swapped atomically)
//   <installDir>/hook               launcher the plugin's hooks exec; absolute Node path; fails open
//   <installDir>/bin/agentwatch     launcher for the command line, linked from ~/.local/bin/agentwatch
//   <installDir>/marketplace/       a one-plugin Claude Code marketplace pointing at this version's plugin

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { Paths } from './paths.ts'
import { VERSION } from './version.ts'

export const MARKETPLACE = 'agentwatch-local'
export const PLUGIN_ID = `agentwatch@${MARKETPLACE}`
export const MIN_NODE_MAJOR = 22

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}
export type Runner = (cmd: string, args: string[]) => RunResult

export const defaultRunner: Runner = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] })
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? (r.error ? String(r.error) : '') }
}

export interface InstallContext {
  paths: Paths
  home: string
  env: NodeJS.ProcessEnv
  /** The directory holding the bundle to install: agentwatch.mjs, hook.mjs and plugin/. */
  bundleDir: string
  /** Node to bake into the launchers (absolute). */
  node: string
  /** Install the Claude Code plugin (default true). */
  claude?: boolean
  run?: Runner
  log?: (line: string) => void
  /** Backup suffix; one per run so every file backed up in one run shares it. */
  stamp?: string
}

export interface PluginResult {
  status: 'installed' | 'updated' | 'enabled' | 'unchanged' | 'skipped' | 'failed'
  detail?: string
  claudeVersion?: string
}

export interface InstallReport {
  version: string
  node: string
  launcher: string
  command: { path: string; linked: boolean; onPath: boolean; detail?: string }
  claude: PluginResult
  codexVersion?: string
  backups: string[]
}

// ── Node ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function nodeMajor(node: string, run: Runner = defaultRunner): number {
  const r = run(node, ['--version'])
  const m = /^v(\d+)\./.exec(r.stdout.trim())
  return r.code === 0 && m ? Number(m[1]) : 0
}

/**
 * The Node the launchers should run: prefer one this user owns (nvm, fnm, volta, PATH) or the system's, newest first,
 * at least v22. Falls back to the Node running this command, which may live in another user's home.
 */
export function pickNode(home: string, env: NodeJS.ProcessEnv, current: string, run: Runner = defaultRunner): string {
  const candidates: string[] = []
  const versionsIn = (dir: string, bin: string) => {
    try {
      return fs
        .readdirSync(dir)
        .filter((v) => /^v?\d+\.\d+\.\d+$/.test(v))
        .sort((a, b) => compareVersions(b.replace(/^v/, ''), a.replace(/^v/, '')))
        .map((v) => path.join(dir, v, bin))
    } catch {
      return []
    }
  }
  candidates.push(...versionsIn(path.join(env.NVM_DIR || path.join(home, '.nvm'), 'versions/node'), 'bin/node'))
  candidates.push(...versionsIn(path.join(home, '.local/share/fnm/node-versions'), 'installation/bin/node'))
  candidates.push(path.join(home, '.volta/bin/node'))
  for (const dir of (env.PATH ?? '').split(path.delimiter)) if (dir) candidates.push(path.join(dir, 'node'))
  candidates.push('/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node')
  const seen = new Set<string>()
  for (const c of candidates) {
    if (seen.has(c) || !isExecutable(c)) continue
    seen.add(c)
    // Skip Nodes in another user's home: they can disappear under us.
    if (c.startsWith('/home/') && !c.startsWith(`${home}/`)) continue
    if (nodeMajor(c, run) >= MIN_NODE_MAJOR) return c
  }
  return current
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK)
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

/** Write a file only when its content changes, atomically. Returns whether it changed. */
function writeIfChanged(file: string, content: string, mode: number): boolean {
  try {
    if (fs.readFileSync(file, 'utf8') === content) {
      fs.chmodSync(file, mode)
      return false
    }
  } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, content, { mode })
  fs.renameSync(tmp, file)
  return true
}

/** Point `link` at `target`, replacing an existing symlink atomically. */
function symlinkAtomic(target: string, link: string): void {
  try {
    if (fs.readlinkSync(link) === target) return
  } catch {}
  const tmp = `${link}.${process.pid}.tmp`
  fs.rmSync(tmp, { force: true })
  fs.symlinkSync(target, tmp)
  fs.renameSync(tmp, link)
}

function stampNow(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z')
}

/** Copy a file we are about to let someone else change to `<file>.agentwatch-<stamp>.bak`, once per run. */
function backup(file: string, stamp: string, done: string[]): void {
  if (!fs.existsSync(file)) return
  const to = `${file}.agentwatch-${stamp}.bak`
  if (done.includes(to)) return
  fs.copyFileSync(file, to)
  fs.chmodSync(to, fs.statSync(file).mode & 0o777)
  done.push(to)
}

// ── Install ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function hookLauncher(node: string, installDir: string): string {
  const hook = path.join(installDir, 'current', 'hook.mjs')
  return `#!/bin/sh
# AgentWatch hook launcher, written by \`agentwatch setup\`. Claude Code's hooks run this on every event.
# It fails open: if Node or AgentWatch is missing it exits 0 with no output, so agents behave as if it weren't here.
[ -x ${sh(node)} ] && [ -f ${sh(hook)} ] || exit 0
exec ${sh(node)} ${sh(hook)} "$@"
`
}

export function commandLauncher(node: string, installDir: string): string {
  return `#!/bin/sh
# AgentWatch command line, written by \`agentwatch setup\`.
exec ${sh(node)} ${sh(path.join(installDir, 'current', 'agentwatch.mjs'))} "$@"
`
}

function sh(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function install(ctx: InstallContext): InstallReport {
  const run = ctx.run ?? defaultRunner
  const log = ctx.log ?? (() => {})
  const stamp = ctx.stamp ?? stampNow()
  const backups: string[] = []
  const dir = ctx.paths.installDir
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 })

  // 1. The bundle, under its version. Re-running from the installed copy itself is a no-op.
  const versionDir = path.join(dir, 'versions', VERSION)
  if (path.resolve(ctx.bundleDir) !== path.resolve(versionDir)) {
    for (const f of ['agentwatch.mjs', 'hook.mjs']) {
      if (!fs.existsSync(path.join(ctx.bundleDir, f))) throw new Error(`The bundle is incomplete: ${f} is missing.`)
    }
    const staging = `${versionDir}.${process.pid}.tmp`
    fs.rmSync(staging, { recursive: true, force: true })
    fs.mkdirSync(staging, { recursive: true })
    for (const f of ['agentwatch.mjs', 'hook.mjs']) fs.copyFileSync(path.join(ctx.bundleDir, f), path.join(staging, f))
    if (fs.existsSync(path.join(ctx.bundleDir, 'plugin')))
      fs.cpSync(path.join(ctx.bundleDir, 'plugin'), path.join(staging, 'plugin'), { recursive: true })
    fs.rmSync(versionDir, { recursive: true, force: true })
    fs.renameSync(staging, versionDir)
  }
  symlinkAtomic(path.join('versions', VERSION), path.join(dir, 'current'))
  pruneVersions(dir, VERSION)

  // 2. Launchers.
  const launcher = path.join(dir, 'hook')
  writeIfChanged(launcher, hookLauncher(ctx.node, dir), 0o755)
  const cmd = path.join(dir, 'bin', 'agentwatch')
  writeIfChanged(cmd, commandLauncher(ctx.node, dir), 0o755)
  const command = linkCommand(ctx, cmd)
  log(`Installed AgentWatch ${VERSION} in ${dir} (Node: ${ctx.node}).`)

  // 3. Claude Code plugin.
  const claude: PluginResult =
    ctx.claude === false
      ? { status: 'skipped', detail: 'Skipped the Claude Code plugin (--no-claude).' }
      : installClaudePlugin(ctx, run, versionDir, (f) => backup(f, stamp, backups))

  // 4. Codex: only detected for now.
  const codex = findOnPath('codex', ctx)
  const cv = codex ? run(codex, ['--version']) : null
  const codexVersion = cv && cv.code === 0 ? cv.stdout.trim().replace(/^codex-cli\s+/, '') : undefined

  return {
    version: VERSION,
    node: ctx.node,
    launcher,
    command,
    claude,
    ...(codexVersion ? { codexVersion } : {}),
    backups,
  }
}

/** Keep the current version and the one before it (a daemon or hook may still be running from it). */
function pruneVersions(dir: string, keep: string): void {
  const versions = path.join(dir, 'versions')
  const older = fs
    .readdirSync(versions)
    .filter((v) => v !== keep && !v.endsWith('.tmp'))
    .sort((a, b) => fs.statSync(path.join(versions, b)).mtimeMs - fs.statSync(path.join(versions, a)).mtimeMs)
  for (const v of older.slice(1)) fs.rmSync(path.join(versions, v), { recursive: true, force: true })
}

function binDir(ctx: Pick<InstallContext, 'env' | 'home'>): string {
  if (ctx.env.AGENTWATCH_HOME) return path.join(ctx.env.AGENTWATCH_HOME, 'bin')
  return ctx.env.XDG_BIN_HOME || path.join(ctx.home, '.local', 'bin')
}

function linkCommand(ctx: InstallContext, target: string): InstallReport['command'] {
  const bin = binDir(ctx)
  const link = path.join(bin, 'agentwatch')
  const onPath = (ctx.env.PATH ?? '').split(path.delimiter).some((d) => path.resolve(d || '.') === path.resolve(bin))
  let existing: string | null = null
  try {
    existing = fs.readlinkSync(link)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EINVAL')
      return { path: link, linked: false, onPath, detail: `${link} exists and isn't ours; left it alone.` }
  }
  if (existing !== null && existing !== target && !existing.includes('agentwatch'))
    return { path: link, linked: false, onPath, detail: `${link} points elsewhere (${existing}); left it alone.` }
  fs.mkdirSync(bin, { recursive: true })
  symlinkAtomic(target, link)
  return { path: link, linked: true, onPath }
}

function findOnPath(name: string, ctx: InstallContext): string | null {
  const dirs = (ctx.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  dirs.push(path.join(ctx.home, '.local/bin'), path.join(ctx.home, '.claude/local'))
  for (const d of dirs) {
    const f = path.join(d, name)
    if (isExecutable(f)) return f
  }
  return null
}

function claudeSettingsFiles(ctx: InstallContext): string[] {
  const dir = ctx.env.CLAUDE_CONFIG_DIR || path.join(ctx.home, '.claude')
  return [path.join(dir, 'settings.json'), path.join(dir, 'plugins', 'known_marketplaces.json')]
}

function json<T>(r: RunResult): T | null {
  if (r.code !== 0) return null
  try {
    return JSON.parse(r.stdout) as T
  } catch {
    return null
  }
}

function installClaudePlugin(
  ctx: InstallContext,
  run: Runner,
  versionDir: string,
  backupFile: (f: string) => void,
): PluginResult {
  const claude = findOnPath('claude', ctx)
  if (!claude) return { status: 'skipped', detail: 'Claude Code not found for this user.' }
  const v = run(claude, ['--version'])
  const claudeVersion = v.code === 0 ? v.stdout.trim().split(/\s+/)[0] : undefined
  const pluginSrc = path.join(versionDir, 'plugin')
  if (!fs.existsSync(path.join(pluginSrc, '.claude-plugin', 'plugin.json')))
    return { status: 'failed', detail: 'This bundle has no Claude Code plugin in it.', claudeVersion }

  // A one-plugin marketplace that always carries this version's plugin.
  const market = path.join(ctx.paths.installDir, 'marketplace')
  const marketPlugin = path.join(market, 'plugins', 'agentwatch')
  fs.rmSync(marketPlugin, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(marketPlugin), { recursive: true })
  fs.cpSync(pluginSrc, marketPlugin, { recursive: true })
  writeIfChanged(
    path.join(market, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify(
      {
        name: MARKETPLACE,
        owner: { name: 'AgentWatch (installed by agentwatch setup)' },
        description: 'The AgentWatch plugin matching the AgentWatch installed for this user.',
        plugins: [
          {
            name: 'agentwatch',
            source: './plugins/agentwatch',
            version: VERSION,
            description: 'Push to your phone when Claude needs you or finishes; approve, answer or reply from there.',
          },
        ],
      },
      null,
      2,
    )}\n`,
    0o644,
  )

  const mutate = (args: string[]): RunResult => {
    for (const f of claudeSettingsFiles(ctx)) backupFile(f)
    return run(claude, args)
  }
  const fail = (what: string, r: RunResult): PluginResult => ({
    status: 'failed',
    detail: `${what} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ') || `exit ${r.code}`}`,
    claudeVersion,
  })

  const markets = json<{ name: string }[]>(run(claude, ['plugin', 'marketplace', 'list', '--json'])) ?? []
  if (!markets.some((m) => m.name === MARKETPLACE)) {
    const r = mutate(['plugin', 'marketplace', 'add', market, '--scope', 'user'])
    if (r.code !== 0) return fail('Adding the local marketplace', r)
  } else {
    const r = run(claude, ['plugin', 'marketplace', 'update', MARKETPLACE])
    if (r.code !== 0) return fail('Refreshing the local marketplace', r)
  }

  type Installed = { id: string; version?: string; scope?: string; enabled?: boolean }
  const installed = (json<Installed[]>(run(claude, ['plugin', 'list', '--json'])) ?? []).find(
    (p) => p.id === PLUGIN_ID && (p.scope ?? 'user') === 'user',
  )
  if (!installed) {
    const r = mutate(['plugin', 'install', PLUGIN_ID, '--scope', 'user'])
    return r.code === 0 ? { status: 'installed', claudeVersion } : fail('Installing the plugin', r)
  }
  if (installed.version !== VERSION) {
    const r = mutate(['plugin', 'update', PLUGIN_ID, '--scope', 'user'])
    if (r.code !== 0) return fail('Updating the plugin', r)
    if (installed.enabled === false) mutate(['plugin', 'enable', PLUGIN_ID, '--scope', 'user'])
    return { status: 'updated', claudeVersion }
  }
  if (installed.enabled === false) {
    const r = mutate(['plugin', 'enable', PLUGIN_ID, '--scope', 'user'])
    return r.code === 0 ? { status: 'enabled', claudeVersion } : fail('Enabling the plugin', r)
  }
  return { status: 'unchanged', claudeVersion }
}

// ── Uninstall ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface UninstallReport {
  removed: string[]
  claude: PluginResult
  backups: string[]
}

export function uninstall(ctx: Omit<InstallContext, 'bundleDir' | 'node'>): UninstallReport {
  const run = ctx.run ?? defaultRunner
  const stamp = ctx.stamp ?? stampNow()
  const backups: string[] = []
  const removed: string[] = []
  let claude: PluginResult = { status: 'skipped', detail: 'Claude Code not found for this user.' }
  const bin = findOnPath('claude', { ...ctx, bundleDir: '', node: '' })
  if (bin) {
    const mutate = (args: string[]) => {
      for (const f of claudeSettingsFiles({ ...ctx, bundleDir: '', node: '' })) backup(f, stamp, backups)
      return run(bin, args)
    }
    type Installed = { id: string; scope?: string }
    const installed = (json<Installed[]>(run(bin, ['plugin', 'list', '--json'])) ?? []).some((p) => p.id === PLUGIN_ID)
    const markets = json<{ name: string }[]>(run(bin, ['plugin', 'marketplace', 'list', '--json'])) ?? []
    claude = { status: 'unchanged' }
    if (installed) {
      const r = mutate(['plugin', 'uninstall', PLUGIN_ID, '--scope', 'user'])
      claude =
        r.code === 0
          ? { status: 'updated', detail: 'Removed the Claude Code plugin.' }
          : { status: 'failed', detail: (r.stderr || r.stdout).trim() }
    }
    if (markets.some((m) => m.name === MARKETPLACE)) mutate(['plugin', 'marketplace', 'remove', MARKETPLACE])
  }
  const link = path.join(binDir(ctx), 'agentwatch')
  try {
    if (fs.readlinkSync(link).startsWith(ctx.paths.installDir)) {
      fs.rmSync(link)
      removed.push(link)
    }
  } catch {}
  if (fs.existsSync(ctx.paths.installDir)) {
    fs.rmSync(ctx.paths.installDir, { recursive: true, force: true })
    removed.push(ctx.paths.installDir)
  }
  return { removed, claude, backups }
}
