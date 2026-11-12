// AgentWatch phone replies. Long-polls this OS user's AgentWatch daemon over its unix socket and submits each reply
// from your phone as your own prompt. The daemon only sends replies while the session is idle. If AgentWatch isn't set
// up, or its daemon isn't running, this backs off quietly and does nothing else.

import type { EngineInterface, Register } from 'claude-code'

const BASE = 'http://agentwatchd/v1/bridge/claude'
const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000

/** One loop per Claude process; it follows the current session id, so /clear and resume keep working. */
let running = false

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    if (!running) {
      running = true
      void bridge($).finally(() => {
        running = false
      })
    }
    return result
  })
}

async function socketPath($: EngineInterface): Promise<string> {
  const root = await $.env.get('AGENTWATCH_HOME')
  if (root) return `${root}/state/agentwatchd.sock`
  const state = await $.env.get('XDG_STATE_HOME')
  const home = await $.env.get('HOME')
  return `${state || `${home}/.local/state`}/agentwatch/agentwatchd.sock`
}

/**
 * The socket and its folder belong to this OS user, and nobody else can write to the folder. Whatever this daemon
 * sends is typed in as you, so a HOME or XDG_STATE_HOME leaked from another account (tmux started from someone else's
 * desktop, say) must never lead here to their daemon, or to one they set up to look like it.
 */
const OWN_CHECK =
  'd=$(dirname "$1") && [ -O "$1" ] && [ -O "$d" ] && case $(ls -ld "$d") in ?????w*|????????w*) exit 1 ;; esac'

async function ours($: EngineInterface, socket: string): Promise<boolean> {
  try {
    return (await $.process.run(['/bin/sh', '-c', OWN_CHECK, 'sh', socket], { timeoutMs: 5_000 })).exitCode === 0
  } catch {
    return false
  }
}

async function bridge($: EngineInterface): Promise<void> {
  const socket = await socketPath($)
  const loop = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  let backoff = MIN_BACKOFF_MS
  let checked = false
  for (;;) {
    const session = await $.session.id()
    try {
      checked ||= await ours($, socket)
      if (!checked) throw new Error('no daemon of ours yet')
      const r = await $.http.fetch(`${BASE}?session=${encodeURIComponent(session)}&loop=${loop}`, {
        socketPath: socket,
      })
      // A reloaded copy of this plugin took over.
      if (r.status === 410) return
      if (r.status === 204) {
        backoff = MIN_BACKOFF_MS
        continue
      }
      if (r.status === 200) {
        backoff = MIN_BACKOFF_MS
        const { messages } = JSON.parse(r.text) as { messages: { id: string; text: string }[] }
        for (const m of messages) await deliver($, socket, session, m)
        continue
      }
    } catch {
      // The daemon isn't running (it starts on the next hook) or AgentWatch isn't set up for this user. Check the
      // socket again before trusting whatever answers there next.
      checked = false
    }
    await $.clock.sleep(backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
}

async function deliver(
  $: EngineInterface,
  socket: string,
  session: string,
  m: { id: string; text: string },
): Promise<void> {
  let ok = false
  let error: string | undefined
  try {
    const res = await $.prompt.submit({ text: m.text, asUser: true })
    ok = !('drop' in res && res.drop !== undefined)
    if (!ok) error = 'a hook dropped it'
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }
  await $.http
    .fetch(`${BASE}/ack`, {
      method: 'POST',
      socketPath: socket,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, id: m.id, ok, ...(error ? { error } : {}) }),
    })
    .catch(() => {})
}
