// `agentwatch rotate`: replace the end-to-end vault key, for a lost phone or a leaked invite. The relay signs out every
// phone and every other computer or OS user (they all hold the old key) and forgets what was sealed with it. This user
// keeps its connection, re-sends its sessions under the new key, and pairs a phone again straight away.

import readline from 'node:readline'
import { parseArgs } from 'node:util'
import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { loadConfig } from '../config.ts'
import { pair } from './pair.ts'

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
  const answer = await new Promise<string>((r) => rl.question(question, r))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

export async function rotate(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { yes: { type: 'boolean', short: 'y' }, 'no-pair': { type: 'boolean' } },
  })
  if (!loadConfig()) {
    console.error('Not set up for this user. Run `agentwatch setup` first.')
    return 1
  }
  console.log('Rotating makes a new end-to-end key. Every paired phone and every other computer or OS user on your')
  console.log('relay is signed out, and their history is cleared. You pair your phone again right after; other')
  console.log('computers rejoin with `agentwatch invite` here and `agentwatch join --force` there.')
  if (!values.yes) {
    if (!process.stdin.isTTY) {
      console.error('\nRun `agentwatch rotate --yes` to confirm.')
      return 64
    }
    if (!(await confirm('\nRotate the key now? [y/N] '))) {
      console.log('Nothing changed.')
      return 1
    }
  }
  if (!(await ensureDaemon()) || !(await waitForRelay())) {
    console.error('The daemon cannot reach your relay right now, so nothing changed. Check `agentwatch status`.')
    return 1
  }
  const r = await call<{ ok?: boolean; error?: string }>('POST', '/v1/rotate', {}, { timeoutMs: 30_000 })
  if (r.status !== 200) {
    console.error(`Rotation failed, nothing changed: ${r.body.error ?? r.status}`)
    return 1
  }
  console.log('\n✓ New key in place. Every phone and every other computer is signed out.')
  if (values['no-pair']) {
    console.log('Pair your phone again with `agentwatch pair`.')
    return 0
  }
  return pair([])
}
