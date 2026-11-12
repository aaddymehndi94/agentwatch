// `agentwatch status` and `agentwatch stop`.

import { call } from '../client.ts'
import { loadConfig } from '../config.ts'
import { socketAlive } from '../daemon/main.ts'
import { paths } from '../paths.ts'

interface Status {
  version: string
  pid: number
  startedAt: number
  user: string
  host: string
  privacy: string
  mute: number | null
  relay: { url: string; connected: boolean; lastError: string | null }
  adapters: string[]
  sessions: { id: string; agent: string; state: string; stateSince: number; project?: string; title?: string }[]
  requests: { id: string; sessionId: string; kind: string; title: string }[]
}

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

export async function status(args: string[]): Promise<number> {
  const p = paths()
  const cfg = loadConfig(p.configFile)
  if (!cfg) {
    console.log('Not set up for this user. Run `agentwatch setup`.')
    return 1
  }
  if (!(await socketAlive(p.socket))) {
    console.log(`Daemon: not running (it starts on the next agent event, or run \`agentwatch daemon\`).`)
    console.log(`Relay:  ${cfg.relayUrl}`)
    return 0
  }
  const r = await call<Status>('GET', '/v1/status')
  const s = r.body
  if (args.includes('--json')) {
    console.log(JSON.stringify(s, null, 2))
    return 0
  }
  console.log(`Daemon: running (pid ${s.pid}, v${s.version}, up ${ago(s.startedAt)}) as ${s.user}@${s.host}`)
  console.log(
    `Relay:  ${s.relay.connected ? 'connected' : `offline${s.relay.lastError ? ` (${s.relay.lastError})` : ''}`} — ${s.relay.url}`,
  )
  console.log(`Privacy: ${s.privacy}${s.mute ? ` · pushes muted until ${new Date(s.mute).toLocaleTimeString()}` : ''}`)
  console.log(`Adapters: ${s.adapters.join(', ') || 'none'}`)
  const live = s.sessions.filter((x) => x.state !== 'ended')
  console.log(`\nSessions (${live.length})`)
  for (const x of live) {
    console.log(
      `  ${x.state.padEnd(9)} ${x.agent.padEnd(7)} ${(x.project ?? '?').padEnd(20)} ${ago(x.stateSince).padStart(6)}  ${x.title ?? ''}`,
    )
  }
  if (s.requests.length) {
    console.log(`\nWaiting on you (${s.requests.length})`)
    for (const q of s.requests) console.log(`  ${q.kind.padEnd(10)} ${q.title}`)
  }
  return 0
}

export async function stop(): Promise<number> {
  const p = paths()
  if (!(await socketAlive(p.socket))) {
    console.log('Daemon is not running.')
    return 0
  }
  await call('POST', '/v1/shutdown')
  for (let i = 0; i < 20 && (await socketAlive(p.socket)); i++) await new Promise((r) => setTimeout(r, 100))
  console.log('Daemon stopped.')
  return 0
}
