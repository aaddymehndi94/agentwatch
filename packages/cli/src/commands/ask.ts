// `agentwatch ask` and `agentwatch emit`: the generic adapter, for scripts and homemade agents.
//
//   answer=$(agentwatch ask "Deploy to production?" --choices "Deploy,Wait")    # prints the label; exit 2 on timeout
//   agentwatch ask --approve "Run the migration?" && ./migrate.sh                # exit 0 approved, 1 denied
//   agentwatch emit --session nightly --state working --message "Step 3 of 5" --pid $$

import { parseArgs } from 'node:util'
import type { AskResult } from '../adapters/generic.ts'
import { call, ensureDaemon } from '../client.ts'
import { loadConfig } from '../config.ts'

/** Exit codes scripts can rely on. */
export const EXIT = { ok: 0, denied: 1, timeout: 2, noDaemon: 3, usage: 64 } as const

/** "90s", "10m", "2h", "1h30m" or plain seconds → ms. */
export function parseDuration(s: string): number {
  const t = s.trim().toLowerCase()
  if (/^\d+$/.test(t)) return Number(t) * 1000
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g
  let ms = 0
  let used = 0
  for (const m of t.matchAll(re)) {
    ms += Number(m[1]) * (m[2] === 'h' ? 3600_000 : m[2] === 'm' ? 60_000 : 1000)
    used += m[0].length
  }
  if (!ms || used !== t.replace(/\s+/g, '').length) throw new Error(`Not a duration: "${s}". Try 90s, 10m or 2h.`)
  return Math.round(ms)
}

async function daemonUp(): Promise<boolean> {
  if (!loadConfig()) {
    console.error('AgentWatch is not set up for this user. Run `agentwatch setup` first.')
    return false
  }
  if (await ensureDaemon()) return true
  console.error('Could not start the AgentWatch daemon. See `agentwatch doctor`.')
  return false
}

export async function ask(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>
  let positionals: string[]
  try {
    ;({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        choices: { type: 'string', short: 'c' },
        multi: { type: 'boolean' },
        approve: { type: 'boolean' },
        detail: { type: 'string' },
        timeout: { type: 'string', short: 't' },
        session: { type: 'string', short: 's' },
        title: { type: 'string' },
        json: { type: 'boolean' },
      },
    }))
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return EXIT.usage
  }
  const question = positionals.join(' ').trim()
  if (!question) {
    console.error('Usage: agentwatch ask "<question>" [--choices a,b,c] [--multi] [--approve] [--timeout 10m]')
    return EXIT.usage
  }
  let timeoutMs: number
  try {
    timeoutMs = parseDuration(String(values.timeout ?? '10m'))
  } catch (e) {
    console.error((e as Error).message)
    return EXIT.usage
  }
  const choices =
    typeof values.choices === 'string'
      ? values.choices
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean)
      : undefined
  if (values.approve && choices) {
    console.error('Use either --approve (Approve / Deny) or --choices, not both.')
    return EXIT.usage
  }
  if (!(await daemonUp())) return EXIT.noDaemon
  if (process.stderr.isTTY) console.error('Waiting for your answer on the phone… (Ctrl-C cancels)')
  const r = await call<AskResult & { error?: string }>(
    'POST',
    '/v1/ask',
    {
      question,
      ...(choices ? { choices } : {}),
      multi: !!values.multi,
      approve: !!values.approve,
      ...(values.detail ? { detail: values.detail } : {}),
      ...(values.session ? { session: values.session } : {}),
      ...(values.title ? { title: values.title } : {}),
      cwd: process.cwd(),
      timeoutMs,
    },
    { timeoutMs: timeoutMs + 30_000 },
  ).catch((e: Error) => ({ status: 0, body: { error: e.message } as AskResult & { error?: string } }))
  if (r.status !== 200) {
    console.error(r.body.error ?? `The daemon answered ${r.status}.`)
    return r.status === 400 ? EXIT.usage : 1
  }
  const res = r.body
  if (values.json) console.log(JSON.stringify(res))
  switch (res.status) {
    case 'answered':
      if (!values.json) for (const a of res.answers) console.log(a)
      return EXIT.ok
    case 'approved':
      if (!values.json) console.log('approved')
      return EXIT.ok
    case 'denied':
      if (!values.json) console.log('denied')
      return EXIT.denied
    case 'expired':
      if (!values.json) console.error('No answer in time.')
      return EXIT.timeout
    default:
      if (!values.json) console.error('The question was cancelled.')
      return EXIT.timeout
  }
}

export async function emit(argv: string[]): Promise<number> {
  let values: Record<string, string | boolean | undefined>
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        session: { type: 'string', short: 's' },
        state: { type: 'string' },
        title: { type: 'string' },
        project: { type: 'string' },
        message: { type: 'string', short: 'm' },
        pid: { type: 'string' },
      },
    }))
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return EXIT.usage
  }
  if (!values.session) {
    console.error(
      'Usage: agentwatch emit --session <name> [--state working|idle|ended] [--title …] [--message …] [--pid <pid>]',
    )
    return EXIT.usage
  }
  if (values.state && !['working', 'idle', 'ended'].includes(String(values.state))) {
    console.error('--state is one of working, idle, ended. (To ask for something, use `agentwatch ask`.)')
    return EXIT.usage
  }
  const pid = values.pid ? Number(values.pid) : undefined
  if (pid !== undefined && !(Number.isInteger(pid) && pid > 0)) {
    console.error('--pid takes a process id, e.g. --pid $$')
    return EXIT.usage
  }
  if (!(await daemonUp())) return EXIT.noDaemon
  const r = await call<{ error?: string }>('POST', '/v1/emit', {
    session: values.session,
    ...(values.state ? { state: values.state } : {}),
    ...(values.title ? { title: values.title } : {}),
    ...(values.project ? { project: values.project } : {}),
    ...(values.message ? { message: values.message } : {}),
    ...(pid ? { pid } : {}),
    cwd: process.cwd(),
  }).catch((e: Error) => ({ status: 0, body: { error: e.message } }))
  if (r.status !== 200) {
    console.error(r.body.error ?? `The daemon answered ${r.status}.`)
    return r.status === 400 ? EXIT.usage : 1
  }
  return EXIT.ok
}
