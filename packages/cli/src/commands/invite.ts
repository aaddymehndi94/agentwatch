// `agentwatch invite`: a one-time invite that adds another OS user or computer to this relay with `agentwatch join`.

import os from 'node:os'
import path from 'node:path'
import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { loadConfig } from '../config.ts'
import { paths } from '../paths.ts'

export async function invite(args: string[]): Promise<number> {
  const cfg = loadConfig()
  if (!cfg) {
    console.error('Not set up for this user. Run `agentwatch setup` first.')
    return 1
  }
  if (!(await ensureDaemon()) || !(await waitForRelay())) {
    console.error('The daemon cannot reach your relay right now. Check `agentwatch doctor`.')
    return 1
  }
  const r = await call<{ code: string; expiresAt: number; error?: string }>('POST', '/v1/pair', {
    kind: 'source',
    meta: { invitedBy: `${os.userInfo().username}@${os.hostname()}` },
  })
  if (r.status !== 200) {
    console.error(`Could not create an invite: ${r.body.error ?? r.status}`)
    return 1
  }
  const link = `${cfg.relayUrl.replace(/\/+$/, '')}/#/join/${r.body.code}`
  if (args.includes('--json')) {
    console.log(JSON.stringify({ link, expiresAt: r.body.expiresAt }))
    return 0
  }
  const minutes = Math.round((r.body.expiresAt - Date.now()) / 60_000)
  const cli = path.join(paths().installDir, 'current', 'agentwatch.mjs')
  console.log(`Invite (works once, for ${minutes} minutes):\n\n  ${link}\n`)
  console.log('On the other computer or OS user, run `agentwatch join` and paste it when asked.')
  console.log('\nAnother OS user on this computer can run this copy of AgentWatch (with sudo, which you run yourself):')
  console.log(`  sudo -iu <user> ${process.execPath} ${cli} join [--privacy summary] [--no-messages]`)
  console.log('\nThe invite carries the key to your agents’ data. Treat it like a password.')
  return 0
}
