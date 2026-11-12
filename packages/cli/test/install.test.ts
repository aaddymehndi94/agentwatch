// The installer against a fake `claude` CLI that keeps its state in a JSON file and edits settings.json the way the
// real one does. Checks idempotency, backups, and that other users' settings keys survive install and uninstall.

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { install, MARKETPLACE, PLUGIN_ID, pickNode, uninstall } from '../src/install.ts'
import { paths } from '../src/paths.ts'
import { VERSION } from '../src/version.ts'
import { buildCli, CLI_DIR } from './harness.ts'

const FAKE_CLAUDE = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path')
const dir = process.env.FAKE_CLAUDE_DIR
const stateFile = path.join(dir, 'state.json')
const settingsFile = path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
const st = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { markets: [], plugins: [] }
const args = process.argv.slice(2)
fs.appendFileSync(path.join(dir, 'calls.log'), args.join(' ') + '\\n')
const settings = () => (fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {})
const saveSettings = (s) => { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(s, null, 2)) }
const save = () => fs.writeFileSync(stateFile, JSON.stringify(st))
const a = args.join(' ')
if (a === '--version') console.log('2.1.322 (Claude Code)')
else if (a === 'plugin marketplace list --json') console.log(JSON.stringify(st.markets))
else if (a === 'plugin list --json') console.log(JSON.stringify(st.plugins))
else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'add') {
  const m = JSON.parse(fs.readFileSync(path.join(args[3], '.claude-plugin/marketplace.json'), 'utf8'))
  st.markets.push({ name: m.name, path: args[3] }); save()
  const s = settings(); s.extraKnownMarketplaces = { ...s.extraKnownMarketplaces, [m.name]: { source: { source: 'directory', path: args[3] } } }; saveSettings(s)
} else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'update') {}
else if (args[0] === 'plugin' && args[1] === 'marketplace' && args[2] === 'remove') {
  st.markets = st.markets.filter((m) => m.name !== args[3]); save()
  const s = settings(); delete (s.extraKnownMarketplaces || {})[args[3]]; saveSettings(s)
} else if (args[0] === 'plugin' && (args[1] === 'install' || args[1] === 'update')) {
  const market = st.markets.find((m) => m.name === args[2].split('@')[1])
  const v = JSON.parse(fs.readFileSync(path.join(market.path, '.claude-plugin/marketplace.json'), 'utf8')).plugins[0].version
  st.plugins = st.plugins.filter((p) => p.id !== args[2]).concat({ id: args[2], version: v, scope: 'user', enabled: true }); save()
  const s = settings(); s.enabledPlugins = { ...s.enabledPlugins, [args[2]]: true }; saveSettings(s)
} else if (args[0] === 'plugin' && args[1] === 'enable') {
  for (const p of st.plugins) if (p.id === args[2]) p.enabled = true; save()
} else if (args[0] === 'plugin' && args[1] === 'uninstall') {
  st.plugins = st.plugins.filter((p) => p.id !== args[2]); save()
  const s = settings(); delete (s.enabledPlugins || {})[args[2]]; saveSettings(s)
} else { console.error('fake claude: unexpected ' + a); process.exit(3) }
`

let tmp: string
let home: string
let fakeBin: string
let env: NodeJS.ProcessEnv
const BUNDLE = path.join(CLI_DIR, 'dist')

const ctx = () => ({ paths: paths(env), home, env, bundleDir: BUNDLE, node: process.execPath, stamp: 'T1' })
const calls = () => fs.readFileSync(path.join(fakeBin, 'calls.log'), 'utf8').trim().split('\n')
const settingsFile = () => path.join(home, '.claude', 'settings.json')
const ORIGINAL = { theme: 'dark', enabledPlugins: { 'other@market': true }, permissions: { allow: ['Bash(ls)'] } }

beforeAll(() => buildCli(), 120_000)

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-install-'))
  home = path.join(tmp, 'home')
  fakeBin = path.join(tmp, 'fakebin')
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })
  fs.mkdirSync(fakeBin)
  fs.writeFileSync(path.join(fakeBin, 'claude'), FAKE_CLAUDE, { mode: 0o755 })
  fs.writeFileSync(settingsFile(), JSON.stringify(ORIGINAL, null, 2))
  env = {
    HOME: home,
    PATH: `${fakeBin}:/usr/bin:/bin`,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    FAKE_CLAUDE_DIR: fakeBin,
  }
  // The fake reads its env from process.env when the installer runs it.
  Object.assign(process.env, { CLAUDE_CONFIG_DIR: env.CLAUDE_CONFIG_DIR, FAKE_CLAUDE_DIR: fakeBin })
})

afterEach(() => {
  delete process.env.FAKE_CLAUDE_DIR
  delete process.env.CLAUDE_CONFIG_DIR
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('install', () => {
  it('installs the bundle, launchers, command and Claude plugin, backing up Claude settings first', () => {
    const r = install(ctx())
    const dir = path.join(home, '.local/share/agentwatch')
    expect(r.claude).toMatchObject({ status: 'installed', claudeVersion: '2.1.322' })
    expect(fs.readlinkSync(path.join(dir, 'current'))).toBe(`versions/${VERSION}`)
    for (const f of ['agentwatch.mjs', 'hook.mjs', 'plugin/hooks/hooks.json', 'plugin/hooks/bridge.ts'])
      expect(fs.existsSync(path.join(dir, 'current', f))).toBe(true)
    expect(fs.readlinkSync(path.join(home, '.local/bin/agentwatch'))).toBe(path.join(dir, 'bin/agentwatch'))
    expect(r.command).toMatchObject({ linked: true, onPath: false })
    expect(calls()).toContain(`plugin marketplace add ${path.join(dir, 'marketplace')} --scope user`)
    expect(calls()).toContain(`plugin install ${PLUGIN_ID} --scope user`)
    // Backed up before the first change, byte for byte.
    const bak = `${settingsFile()}.agentwatch-T1.bak`
    expect(r.backups).toContain(bak)
    expect(JSON.parse(fs.readFileSync(bak, 'utf8'))).toEqual(ORIGINAL)
    // Their keys survive; ours was added by Claude's own CLI.
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    expect(s).toMatchObject({ ...ORIGINAL, enabledPlugins: { 'other@market': true, [PLUGIN_ID]: true } })
    expect(
      JSON.parse(fs.readFileSync(path.join(dir, 'marketplace/.claude-plugin/marketplace.json'), 'utf8')),
    ).toMatchObject({ name: MARKETPLACE, plugins: [{ name: 'agentwatch', version: VERSION }] })
  })

  it('the hook launcher fails open: exit 0, no output, when AgentWatch is not configured or Node is gone', () => {
    install(ctx())
    const launcher = path.join(home, '.local/share/agentwatch/hook')
    const ok = spawnSync(launcher, ['claude'], {
      input: '{"hook_event_name":"Stop","session_id":"x"}',
      env: { ...env, AGENTWATCH_HOME: path.join(tmp, 'unconfigured') },
      encoding: 'utf8',
    })
    expect(ok).toMatchObject({ status: 0, stdout: '' })
    const broken = install({ ...ctx(), node: path.join(tmp, 'no-such-node') })
    expect(broken.node).toContain('no-such-node')
    const gone = spawnSync(launcher, ['claude'], { input: '{}', env, encoding: 'utf8' })
    expect(gone).toMatchObject({ status: 0, stdout: '', stderr: '' })
  })

  it('running it again changes nothing and backs nothing up', () => {
    install(ctx())
    const before = calls().length
    const again = install({ ...ctx(), stamp: 'T2' })
    expect(again.claude.status).toBe('unchanged')
    expect(again.backups).toEqual([])
    const later = calls().slice(before)
    expect(later.some((c) => /marketplace add|plugin install|plugin update|plugin enable/.test(c))).toBe(false)
    expect(fs.existsSync(`${settingsFile()}.agentwatch-T2.bak`)).toBe(false)
  })

  it('updates a plugin installed by an older version, and re-enables one that was turned off', () => {
    install(ctx())
    const stateFile = path.join(fakeBin, 'state.json')
    const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
    st.plugins[0].version = '0.0.1'
    st.plugins[0].enabled = false
    fs.writeFileSync(stateFile, JSON.stringify(st))
    expect(install({ ...ctx(), stamp: 'T2' }).claude.status).toBe('updated')
    expect(calls()).toContain(`plugin update ${PLUGIN_ID} --scope user`)
    expect(calls()).toContain(`plugin enable ${PLUGIN_ID} --scope user`)
  })

  it('skips the plugin when Claude Code is not installed, or when asked to', () => {
    fs.rmSync(path.join(fakeBin, 'claude'))
    expect(install(ctx()).claude.status).toBe('skipped')
    expect(install({ ...ctx(), claude: false }).claude).toMatchObject({ status: 'skipped', detail: /--no-claude/ })
  })

  it('leaves a ~/.local/bin/agentwatch that is not ours alone', () => {
    fs.mkdirSync(path.join(home, '.local/bin'), { recursive: true })
    fs.writeFileSync(path.join(home, '.local/bin/agentwatch'), '#!/bin/sh\necho mine\n', { mode: 0o755 })
    const r = install(ctx())
    expect(r.command.linked).toBe(false)
    expect(fs.readFileSync(path.join(home, '.local/bin/agentwatch'), 'utf8')).toContain('echo mine')
  })
})

describe('uninstall', () => {
  it('removes what install added and leaves everything else in Claude settings', () => {
    install(ctx())
    const r = uninstall({ paths: paths(env), home, env, stamp: 'T3' })
    expect(r.claude.status).toBe('updated')
    expect(fs.existsSync(path.join(home, '.local/share/agentwatch'))).toBe(false)
    expect(fs.existsSync(path.join(home, '.local/bin/agentwatch'))).toBe(false)
    expect(calls()).toContain(`plugin marketplace remove ${MARKETPLACE}`)
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
    expect(s.enabledPlugins).toEqual(ORIGINAL.enabledPlugins)
    expect(s).toMatchObject({ theme: 'dark', permissions: ORIGINAL.permissions })
    expect(r.backups).toContain(`${settingsFile()}.agentwatch-T3.bak`)
  })
})

describe('pickNode', () => {
  const fakeNode = (file: string, version: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `#!/bin/sh\necho ${version}\n`, { mode: 0o755 })
  }

  it('prefers the newest Node 22+ this user owns over the one running setup', () => {
    fakeNode(path.join(home, '.nvm/versions/node/v20.11.0/bin/node'), 'v20.11.0')
    fakeNode(path.join(home, '.nvm/versions/node/v24.1.0/bin/node'), 'v24.1.0')
    fakeNode(path.join(home, '.nvm/versions/node/v22.9.0/bin/node'), 'v22.9.0')
    expect(pickNode(home, { PATH: '' }, '/elsewhere/node')).toBe(path.join(home, '.nvm/versions/node/v24.1.0/bin/node'))
  })

  it('falls back to the running Node when this user has nothing new enough', () => {
    fakeNode(path.join(home, '.nvm/versions/node/v18.18.2/bin/node'), 'v18.18.2')
    expect(pickNode(home, { PATH: '' }, '/elsewhere/node')).toMatch(/node$/)
    expect(execFileSync(pickNode(home, { PATH: '' }, process.execPath), ['--version'], { encoding: 'utf8' })).toMatch(
      /^v(2[2-9]|[3-9]\d)\./,
    )
  })
})
