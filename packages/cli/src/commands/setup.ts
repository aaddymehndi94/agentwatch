// `agentwatch setup`: connect this OS user to a relay. For the first machine it claims the relay with the
// deploy-time claim secret and creates a fresh vault key. (Plugin install, launcher and service units: ticket 06.)

import { parseArgs } from 'node:util'
import { generateVaultKey } from '@agentwatch/protocol'
import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { Config, loadConfig, saveConfig } from '../config.ts'
import { socketAlive } from '../daemon/main.ts'
import { paths } from '../paths.ts'

export async function setup(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      relay: { type: 'string' },
      'claim-secret': { type: 'string' },
      privacy: { type: 'string', default: 'full' },
      'no-messages': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
    },
  })
  const p = paths()
  if (loadConfig(p.configFile) && !values.force) {
    console.error(`Already set up (${p.configFile}). Use --force to replace it; paired phones will need re-pairing.`)
    return 1
  }
  const relayUrl = values.relay?.replace(/\/+$/, '')
  const claimSecret = values['claim-secret'] ?? process.env.AGENTWATCH_CLAIM_SECRET
  if (!relayUrl || !claimSecret) {
    console.error('Usage: agentwatch setup --relay https://<your-relay> --claim-secret <secret>')
    return 64
  }
  if (values.privacy !== 'full' && values.privacy !== 'summary') {
    console.error('--privacy must be "full" or "summary"')
    return 64
  }
  const res = await fetch(`${relayUrl}/api/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimSecret }),
  })
  const body = (await res.json().catch(() => ({}))) as { sourceId?: string; sourceToken?: string; error?: string }
  if (!res.ok || !body.sourceId || !body.sourceToken) {
    console.error(`The relay refused the claim: ${body.error ?? `HTTP ${res.status}`}`)
    return 1
  }
  const cfg = Config.parse({
    relayUrl,
    sourceId: body.sourceId,
    sourceToken: body.sourceToken,
    vaultKey: generateVaultKey(),
    privacy: values.privacy,
    allowMessages: !values['no-messages'],
  })
  saveConfig(cfg, p.configFile)
  console.log(`Saved ${p.configFile} (mode 0600).`)
  // Restart the daemon so it picks up the new config.
  if (await socketAlive(p.socket)) await call('POST', '/v1/shutdown').catch(() => {})
  for (let i = 0; i < 20 && (await socketAlive(p.socket)); i++) await new Promise((r) => setTimeout(r, 100))
  if ((await ensureDaemon(p)) && (await waitForRelay())) console.log('Daemon running and connected to your relay.')
  else console.log('Saved, but the daemon could not connect yet. Check `agentwatch status`.')
  console.log('Next: `agentwatch pair` to add your phone.')
  return 0
}
