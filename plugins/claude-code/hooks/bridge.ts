// AgentWatch phone replies and usage. Long-polls this OS user's AgentWatch daemon over its unix socket and submits each
// reply from your phone as your own prompt. While Claude works, Claude queues the reply as its next turn: this says so
// at once (`queued`) rather than when the turn ends, and keeps polling. After each turn (and every 5 minutes during a
// long one) it reports `$.session.usage()`: rate limits, context fill and cost, for the meters on the phone. If
// AgentWatch isn't set up, or its daemon isn't running, this backs off quietly and does nothing else.

import type { EngineInterface, Register } from 'claude-code'

const BASE = 'http://agentwatchd/v1/bridge/claude'
const MIN_BACKOFF_MS = 2_000
const MAX_BACKOFF_MS = 60_000
/** `submit` resolves when the prompt enters: at once when Claude is idle, after the turn when it's busy. */
const QUEUED_AFTER_MS = 1_500
/** Version 2 acks a reply that waits for the running turn as `queued`, so the daemon sends replies while busy. */
const BRIDGE_VERSION = 2

/** How often usage is reported while a turn runs, so a limit crossed mid-turn still reaches the phone. */
const USAGE_EVERY_MS = 5 * 60_000

/** One loop per Claude process; it follows the current session id, so /clear and resume keep working. */
let running = false
/** The daemon's socket once it passed the ownership check; usage goes nowhere else. */
let trusted: string | null = null
let turnRunning = false
let lastUsage = 0

export const register: Register = (on) => {
  // The main loop's turns only: a subagent's turn carries its `agentId`.
  on('turn.start', (_$, e, next) => {
    if (e.agentId === undefined) turnRunning = true
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      turnRunning = false
      void reportUsage($)
    }
    return next(e)
  })
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
      trusted = socket
      if (turnRunning && (await $.clock.now()) - lastUsage >= USAGE_EVERY_MS) void reportUsage($)
      const r = await $.http.fetch(`${BASE}?session=${encodeURIComponent(session)}&loop=${loop}&v=${BRIDGE_VERSION}`, {
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
      trusted = null
    }
    await $.clock.sleep(backoff)
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS)
  }
}

/** The status line's figures (free to read): the account's rate limits, and this session's context and cost. */
async function reportUsage($: EngineInterface): Promise<void> {
  const socket = trusted
  if (!socket) return
  try {
    lastUsage = await $.clock.now()
    const { context, rateLimits, cost } = await $.session.usage()
    const session = await $.session.id()
    await $.http.fetch(`${BASE}/usage`, {
      method: 'POST',
      socketPath: socket,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ session, usage: { context, rateLimits, cost } }),
    })
  } catch {
    // Usage is a nicety: never let it get in the way.
  }
}

type Outcome = { ok: boolean; error?: string }

async function deliver(
  $: EngineInterface,
  socket: string,
  session: string,
  m: { id: string; text: string },
): Promise<void> {
  const submitted: Promise<Outcome> = $.prompt.submit({ text: m.text, asUser: true }).then(
    (res) => ('drop' in res && res.drop !== undefined ? { ok: false, error: 'a hook dropped it' } : { ok: true }),
    (err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
  )
  const early = await Promise.race([submitted, $.clock.sleep(QUEUED_AFTER_MS).then(() => null)])
  if (early) return ack($, socket, { session, id: m.id, ...early })
  // Claude is mid-turn and queued it. Say so now, and don't hold up the next poll for the rest of the turn.
  await ack($, socket, { session, id: m.id, ok: true, queued: true })
  void submitted.then((late) => (late.ok ? undefined : ack($, socket, { session, id: m.id, ...late })))
}

async function ack(
  $: EngineInterface,
  socket: string,
  body: { session: string; id: string; ok: boolean; error?: string; queued?: boolean },
): Promise<void> {
  await $.http
    .fetch(`${BASE}/ack`, {
      method: 'POST',
      socketPath: socket,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    .then(
      () => undefined,
      () => undefined,
    )
}
