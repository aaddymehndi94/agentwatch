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

async function bridge($: EngineInterface): Promise<void> {
  const socket = await socketPath($)
  const loop = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  let backoff = MIN_BACKOFF_MS
  for (;;) {
    const session = await $.session.id()
    try {
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
      // The daemon isn't running (it starts on the next hook) or AgentWatch isn't set up for this user.
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
