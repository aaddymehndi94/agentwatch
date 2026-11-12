// `agentwatch join`: add this OS user (or this computer) to a relay that is already set up elsewhere. Reads the invite
// from `agentwatch invite` on stdin, so it never lands in shell history or `ps`. The invite carries the vault key,
// wrapped under a one-time secret; the relay hands out a source token for this user and forgets the invite.

import os from 'node:os'
import readline from 'node:readline'
import { parseArgs } from 'node:util'
import { parsePairingCode, unwrapVaultKey } from '@agentwatch/protocol'
import { Config, loadConfig, relayUrlProblem } from '../config.ts'
import { paths } from '../paths.ts'
import { applyFlags, finishSetup, INSTALL_FLAGS } from './setup.ts'

/** Accepts the invite link (`https://relay/#/join/<code>`), or a bare code with `--relay`. */
export function parseInvite(input: string, relay?: string): { relayUrl: string; code: string } {
  const s = input.trim()
  const checked = (relayUrl: string, code: string) => {
    const problem = relayUrlProblem(relayUrl)
    if (problem) throw new Error(`That invite's relay address ${problem}: ${relayUrl}`)
    return { relayUrl, code }
  }
  const m = /^(https?:\/\/[^#\s]+?)\/?#\/join\/(\S+)$/.exec(s)
  if (m) return checked(m[1]!.replace(/\/+$/, ''), decodeURIComponent(m[2]!))
  if (/^https?:\/\//.test(s) && s.includes('#/pair/'))
    throw new Error('That is a phone pairing link. For a computer, run `agentwatch invite` where AgentWatch is set up.')
  if (relay && /^[\w-]+\.[\w-]+$/.test(s)) return checked(relay.replace(/\/+$/, ''), s)
  throw new Error('That does not look like an invite. Paste the whole link that `agentwatch invite` printed.')
}

/** Say what joining hands over, and get a yes. Joining a stranger's relay would give them your agents. */
async function confirmJoin(relayUrl: string, cfg: Config, yes: boolean, interactive: boolean): Promise<boolean> {
  const who = `${os.userInfo().username}@${os.hostname()}`
  const grants = [
    cfg.privacy === 'summary'
      ? 'see when its agents work and need you (summary privacy: no text leaves this user)'
      : 'read what its agents are doing (prompts, commands, file paths)',
    'approve or deny its agents’ requests and answer their questions',
    ...(cfg.allowMessages ? ['type replies into its idle agents (turn off with --no-messages)'] : []),
  ]
  console.error(`Joining connects ${who} to the relay at ${new URL(relayUrl).host}.`)
  console.error('Whoever owns that relay, and every phone paired with it, can then:')
  for (const g of grants) console.error(`  • ${g}`)
  if (yes) return true
  if (!interactive) {
    console.error('\nRun `agentwatch join --yes` to confirm.')
    return false
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise<string>((r) => rl.question('Join only if this is your own relay. Join? [y/N] ', r))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

async function readInvite(): Promise<string> {
  if (!process.stdin.isTTY) {
    let s = ''
    for await (const c of process.stdin) s += c
    return s.trim()
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise<string>((r) => rl.question('Paste the invite from `agentwatch invite`: ', r))
  rl.close()
  return answer.trim()
}

export async function join(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { ...INSTALL_FLAGS, relay: { type: 'string' }, yes: { type: 'boolean', short: 'y' } },
  })
  const p = paths()
  const existing = loadConfig(p.configFile)
  if (existing && !values.force) {
    console.error(`This user is already connected to ${existing.relayUrl}. Run \`agentwatch setup\` to refresh it,`)
    console.error('or `agentwatch join --force` to replace that connection.')
    return 1
  }
  let invite: { relayUrl: string; code: string }
  try {
    invite = parseInvite(await readInvite(), values.relay)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return 1
  }
  let secret: ReturnType<typeof parsePairingCode>
  try {
    secret = parsePairingCode(invite.code)
  } catch {
    console.error('That invite code is damaged. Copy the whole link again.')
    return 1
  }
  // Ask before using the invite: declining leaves it unused.
  const planned = applyFlags(
    Config.parse({ relayUrl: invite.relayUrl, sourceId: '-', sourceToken: '-', vaultKey: '-' }),
    values,
  )
  if (!planned) return 64
  if (!(await confirmJoin(invite.relayUrl, planned, !!values.yes, !!process.stdin.isTTY))) {
    console.error('Not joined. The invite is still unused.')
    return 64
  }
  let res: Response
  try {
    res = await fetch(`${invite.relayUrl}/api/pair/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairId: secret.pairId, name: `${os.userInfo().username}@${os.hostname()}` }),
    })
  } catch (e) {
    console.error(`Could not reach ${invite.relayUrl}: ${e instanceof Error ? e.message : String(e)}`)
    return 1
  }
  const body = (await res.json().catch(() => ({}))) as {
    kind?: string
    sourceId?: string
    sourceToken?: string
    wrapped?: string
    error?: string
  }
  if (res.status === 410) {
    console.error('That invite has expired or was already used. Run `agentwatch invite` again for a new one.')
    return 1
  }
  if (!res.ok || body.kind !== 'source' || !body.sourceId || !body.sourceToken || !body.wrapped) {
    console.error(
      body.kind === 'device'
        ? 'That was a phone pairing code, and it is now used up. Run `agentwatch invite` for a computer invite.'
        : `The relay refused the invite: ${body.error ?? `HTTP ${res.status}`}`,
    )
    return 1
  }
  let vaultKey: string
  try {
    vaultKey = await unwrapVaultKey(body.wrapped, secret)
  } catch {
    console.error('Could not unlock the key in that invite. Ask for a new invite.')
    return 1
  }
  const cfg = applyFlags(
    Config.parse({ relayUrl: invite.relayUrl, sourceId: body.sourceId, sourceToken: body.sourceToken, vaultKey }),
    values,
  )
  if (!cfg) return 64
  console.log(`✓ Joined ${new URL(invite.relayUrl).host} as ${os.userInfo().username}@${os.hostname()}`)
  return finishSetup(p, cfg, values, existing)
}
