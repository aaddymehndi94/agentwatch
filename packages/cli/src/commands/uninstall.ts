// `agentwatch uninstall [--purge]`: stop the daemon and remove what setup installed for this OS user. Keeps the config
// (it holds this user's key and relay token) unless --purge.

import fs from 'node:fs'
import os from 'node:os'
import { call } from '../client.ts'
import { socketAlive } from '../daemon/main.ts'
import { uninstall as remove } from '../install.ts'
import { paths } from '../paths.ts'
import { tilde } from './setup.ts'

export async function uninstall(args: string[]): Promise<number> {
  const p = paths()
  if (await socketAlive(p.socket)) {
    await call('POST', '/v1/shutdown').catch(() => {})
    for (let i = 0; i < 30 && (await socketAlive(p.socket)); i++) await new Promise((r) => setTimeout(r, 100))
    console.log('✓ Daemon stopped')
  }
  const r = remove({ paths: p, home: process.env.HOME || os.homedir(), env: process.env })
  if (r.claude.status === 'updated') console.log('✓ Removed the Claude Code plugin (restart Claude sessions)')
  else if (r.claude.status === 'failed') console.log(`! Could not remove the Claude Code plugin: ${r.claude.detail}`)
  for (const f of r.removed) console.log(`✓ Removed ${tilde(f)}`)
  for (const b of r.backups) console.log(`    backed up ${tilde(b)}`)
  if (args.includes('--purge')) {
    for (const f of [p.configFile, p.stateDir]) {
      if (fs.existsSync(f)) {
        fs.rmSync(f, { recursive: true, force: true })
        console.log(`✓ Removed ${tilde(f)}`)
      }
    }
    console.log('This computer still shows on your relay; remove it from the app if you like.')
  } else if (fs.existsSync(p.configFile)) {
    console.log(`Kept ${tilde(p.configFile)} (this user's key). \`agentwatch uninstall --purge\` removes it too.`)
  }
  return 0
}
