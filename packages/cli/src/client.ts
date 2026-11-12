// Talking to this user's daemon from CLI commands: HTTP over the unix socket, starting the daemon if needed.

import { spawn } from 'node:child_process'
import http from 'node:http'
import { socketAlive } from './daemon/main.ts'
import { type Paths, paths } from './paths.ts'

export interface Reply<T = unknown> {
  status: number
  body: T
}

export function call<T = unknown>(
  method: string,
  urlPath: string,
  body?: unknown,
  opts: { socket?: string; timeoutMs?: number } = {},
): Promise<Reply<T>> {
  const socket = opts.socket ?? paths().socket
  const payload = body === undefined ? '' : JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: socket,
        path: urlPath,
        method,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let out = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (out += c))
        res.on('end', () => {
          let parsed: unknown = out
          if ((res.headers['content-type'] ?? '').includes('json')) {
            try {
              parsed = JSON.parse(out)
            } catch {}
          }
          resolve({ status: res.statusCode ?? 0, body: parsed as T })
        })
      },
    )
    req.setTimeout(opts.timeoutMs ?? 15_000, () => req.destroy(new Error('the daemon did not answer in time')))
    req.on('error', reject)
    req.end(payload)
  })
}

/** Make sure the daemon is running (spawning it detached if not). Resolves true once its socket answers. */
export async function ensureDaemon(
  p: Paths = paths(),
  waitMs = 4000,
  run: { node: string; entry: string | undefined } = { node: process.execPath, entry: process.argv[1] },
): Promise<boolean> {
  if (await socketAlive(p.socket)) return true
  if (!run.entry) return false
  const child = spawn(run.node, [run.entry, 'daemon'], { detached: true, stdio: 'ignore', env: process.env })
  child.unref()
  const until = Date.now() + waitMs
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 150))
    if (await socketAlive(p.socket)) return true
  }
  return false
}

/** Wait until the daemon reports a live relay connection. */
export async function waitForRelay(timeoutMs = 8000): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const r = await call<{ relay: { connected: boolean } }>('GET', '/v1/status')
      if (r.body.relay?.connected) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
