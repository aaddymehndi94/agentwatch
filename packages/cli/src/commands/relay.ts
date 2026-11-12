// `agentwatch relay deploy`: deploy the relay (Worker + Durable Object + the phone app) to your own Cloudflare account
// with wrangler, give it a fresh claim secret and claim it for this OS user. Runs from a clone of the AgentWatch repo.
// Re-running it upgrades the relay in place; a relay that is already claimed stays yours.

import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { generateVaultKey } from '@agentwatch/protocol'
import { Config, loadConfig } from '../config.ts'
import { paths } from '../paths.ts'
import { applyFlags, claimRelay, finishSetup, INSTALL_FLAGS } from './setup.ts'

function findRepo(): { relayDir: string; appDir: string } | null {
  // The bundle lives in packages/cli/dist; the relay and app sit next to it in a checkout.
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const root of [path.resolve(here, '../..'), path.resolve(here, '../../..'), process.cwd()]) {
    const relayDir = path.join(root, 'relay')
    const pkgRelay = path.join(root, 'packages', 'relay')
    for (const d of [relayDir, pkgRelay]) {
      if (fs.existsSync(path.join(d, 'wrangler.jsonc'))) return { relayDir: d, appDir: path.join(d, '..', 'app') }
    }
  }
  return null
}

/**
 * A package's command-line script, found through its package.json `bin`: packages like wrangler 4 don't export their
 * bin files, so `require.resolve('wrangler/bin/wrangler.js')` fails even when wrangler is installed.
 */
export function packageBin(fromDir: string, pkg: string, name = pkg): string | null {
  try {
    const manifest = createRequire(path.join(fromDir, 'package.json')).resolve(`${pkg}/package.json`)
    const { bin } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { bin?: string | Record<string, string> }
    const rel = typeof bin === 'string' ? bin : bin?.[name]
    return rel ? path.join(path.dirname(manifest), rel) : null
  } catch {
    return null
  }
}

const wranglerBin = (relayDir: string) => packageBin(relayDir, 'wrangler')

/** Run wrangler, echoing its output, and return what it printed. */
function wrangler(bin: string, cwd: string, args: string[], input?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    const echo = (c: Buffer) => {
      out += c.toString()
      process.stderr.write(c)
    }
    child.stdout.on('data', echo)
    child.stderr.on('data', echo)
    child.stdin.end(input ?? '')
    child.on('close', (code) => resolve({ code: code ?? 1, out }))
  })
}

export async function relay(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv
  if (sub !== 'deploy') {
    console.error('Usage: agentwatch relay deploy [--privacy full|summary] [--no-messages] [--no-claude]')
    return 64
  }
  const { values } = parseArgs({ args: rest, options: { ...INSTALL_FLAGS } })
  const repo = findRepo()
  if (!repo) {
    console.error('Run this from a clone of the AgentWatch repo: it deploys packages/relay with wrangler.')
    return 1
  }
  const bin = wranglerBin(repo.relayDir)
  if (!bin) {
    console.error('wrangler is not installed in the repo. Run `pnpm install` first.')
    return 1
  }
  const who = spawnSync(process.execPath, [bin, 'whoami'], { cwd: repo.relayDir, encoding: 'utf8' })
  if (who.status !== 0 || /not authenticated|You are not logged in/i.test(`${who.stdout}${who.stderr}`)) {
    console.error('Log in to Cloudflare first (it opens your browser):  npx wrangler login')
    return 1
  }
  if (!fs.existsSync(path.join(repo.appDir, 'dist', 'index.html'))) {
    console.log('Building the phone app…')
    const vite = packageBin(repo.appDir, 'vite')
    if (!vite) {
      console.error('vite is not installed in the repo. Run `pnpm install` first.')
      return 1
    }
    const b = spawnSync(process.execPath, [vite, 'build'], { cwd: repo.appDir, stdio: 'inherit' })
    if (b.status !== 0) return 1
  }

  console.log('Deploying the relay to your Cloudflare account…')
  const d = await wrangler(bin, repo.relayDir, ['deploy'])
  if (d.code !== 0) {
    if (/workers\.dev subdomain/i.test(d.out)) {
      // A new Cloudflare account: its workers.dev subdomain is picked once, in the dashboard.
      console.error('\nYour Cloudflare account needs a workers.dev subdomain first (a one-time choice). Open')
      console.error('dash.cloudflare.com → Workers & Pages, pick one, then run `agentwatch relay deploy` again.')
      console.error('The relay will be at https://agentwatch.<subdomain>.workers.dev.')
    } else console.error('\nwrangler deploy failed (see above).')
    return 1
  }
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(d.out)?.[0]
  if (!url) {
    console.error('\nDeployed, but could not find the relay URL in wrangler’s output. Finish with:')
    console.error('  agentwatch setup --relay https://<your-relay>   (paste the claim secret when asked)')
    return 1
  }
  console.log(`\n✓ Relay deployed: ${url}`)

  const health = await waitForHealth(url)
  const existing = loadConfig(paths().configFile)
  if (health?.claimed) {
    if (existing?.relayUrl === url) {
      console.log('✓ Relay updated; it is still yours.')
      return finishSetup(paths(), existing, values, existing)
    }
    console.log(
      'This relay is already claimed. Use `agentwatch invite` / `agentwatch join` to add users and computers.',
    )
    return 0
  }
  if (existing && !values.force) {
    console.error(`This user is already connected to ${existing.relayUrl}; use --force to switch to the new relay.`)
    return 1
  }

  // Fresh relay: give it a claim secret only we know, then claim it straight away.
  const claimSecret = randomBytes(24).toString('base64url')
  const s = await wrangler(bin, repo.relayDir, ['secret', 'put', 'CLAIM_SECRET'], `${claimSecret}\n`)
  if (s.code !== 0) {
    console.error('\nCould not set the claim secret (see above).')
    return 1
  }
  let claimed: Awaited<ReturnType<typeof claimRelay>> = null
  for (let i = 0; i < 10 && !claimed; i++) {
    // The new secret takes a few seconds to reach the edge.
    await new Promise((r) => setTimeout(r, 2000))
    claimed = await claimRelayQuietly(url, claimSecret)
  }
  if (!claimed) claimed = await claimRelay(url, claimSecret)
  if (!claimed) {
    console.error(`Finish later with \`agentwatch setup --relay ${url}\`, and paste this claim secret when asked:`)
    console.error(`  ${claimSecret}`)
    return 1
  }
  console.log('✓ Relay claimed: it now only accepts this user, and computers and phones you add.')
  const cfg = applyFlags(Config.parse({ relayUrl: url, ...claimed, vaultKey: generateVaultKey() }), values)
  if (!cfg) return 64
  return finishSetup(paths(), cfg, values, existing)
}

async function waitForHealth(url: string): Promise<{ ok: boolean; claimed: boolean } | null> {
  for (let i = 0; i < 15; i++) {
    try {
      const r = await fetch(`${url}/api/health`)
      if (r.ok) return (await r.json()) as { ok: boolean; claimed: boolean }
    } catch {}
    await new Promise((r) => setTimeout(r, 2000))
  }
  return null
}

async function claimRelayQuietly(url: string, claimSecret: string) {
  try {
    const r = await fetch(`${url}/api/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ claimSecret }),
    })
    if (!r.ok) return null
    const b = (await r.json()) as { sourceId?: string; sourceToken?: string }
    return b.sourceId && b.sourceToken ? { sourceId: b.sourceId, sourceToken: b.sourceToken } : null
  } catch {
    return null
  }
}
