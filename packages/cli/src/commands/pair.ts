// `agentwatch pair`: create a one-time pairing and show it as a QR code + link for the phone.
// The vault key travels wrapped under a secret that only exists in the link's #fragment.

import QRCode from 'qrcode'
import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { loadConfig } from '../config.ts'

export async function pair(args: string[]): Promise<number> {
  if (!loadConfig()) {
    console.error('Not set up for this user. Run `agentwatch setup` first.')
    return 1
  }
  if (!(await ensureDaemon())) {
    console.error('Could not start the daemon. See `agentwatch status` and the log in ~/.local/state/agentwatch/.')
    return 1
  }
  if (!(await waitForRelay())) {
    console.error('The daemon cannot reach your relay right now. Check `agentwatch status`.')
    return 1
  }
  const r = await call<{ code: string; link: string; expiresAt: number; error?: string }>('POST', '/v1/pair', {
    kind: 'device',
  })
  if (r.status !== 200) {
    console.error(`Pairing failed: ${r.body.error ?? r.status}`)
    return 1
  }
  const { link, code, expiresAt } = r.body
  if (args.includes('--json')) {
    console.log(JSON.stringify(r.body))
    return 0
  }
  const minutes = Math.round((expiresAt - Date.now()) / 60_000)
  console.log('\nScan with your phone camera:\n')
  console.log(await QRCode.toString(link, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }))
  console.log(`Or open:  ${link}`)
  console.log(`\niPhone: open the link in Safari, tap Share → Add to Home Screen, open AgentWatch from the`)
  console.log(`Home Screen and choose "Paste pairing code":  ${code}`)
  console.log(`\nThis code works once and expires in ${minutes} minutes. Treat it like a password.`)
  return 0
}
