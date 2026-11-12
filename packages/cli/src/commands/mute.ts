// `agentwatch mute [30m|1h|8h|until HH:MM|off]`: pause notifications to every paired phone. The app still shows everything.

import { call, ensureDaemon, waitForRelay } from '../client.ts'
import { loadConfig } from '../config.ts'

/** Parses a mute duration into an absolute time, or null for "off". Throws on anything it doesn't understand. */
export function parseMute(args: string[], now = Date.now()): number | null {
  const a = args.join(' ').trim().toLowerCase()
  if (a === 'off' || a === 'none' || a === '0') return null
  if (a === '') return now + 3600_000
  const d = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?)$/.exec(a)
  if (d) {
    const n = Number(d[1])
    const ms = d[2]!.startsWith('h') ? n * 3600_000 : n * 60_000
    if (ms <= 0 || ms > 7 * 24 * 3600_000) throw new Error('Mute for between a minute and a week.')
    return Math.round(now + ms)
  }
  const t = /^(?:until\s+)?(\d{1,2}):(\d{2})$/.exec(a)
  if (t) {
    const h = Number(t[1])
    const m = Number(t[2])
    if (h > 23 || m > 59) throw new Error(`Not a time: ${a}`)
    const at = new Date(now)
    at.setHours(h, m, 0, 0)
    if (at.getTime() <= now) at.setDate(at.getDate() + 1)
    return at.getTime()
  }
  throw new Error(`Don't understand "${a}". Try: 30m, 1h, 8h, until 08:00, off.`)
}

export async function mute(args: string[]): Promise<number> {
  if (!loadConfig()) {
    console.error('Not set up for this user. Run `agentwatch setup` first.')
    return 1
  }
  const until = parseMute(args)
  if (!(await ensureDaemon()) || !(await waitForRelay())) {
    console.error('The daemon cannot reach your relay right now. Check `agentwatch doctor`.')
    return 1
  }
  const r = await call<{ mute: number | null; error?: string }>('POST', '/v1/mute', { until })
  if (r.status !== 200) {
    console.error(`Could not change mute: ${r.body.error ?? r.status}`)
    return 1
  }
  console.log(
    until
      ? `Notifications muted until ${new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}, for every phone and machine.`
      : 'Notifications on.',
  )
  return 0
}
