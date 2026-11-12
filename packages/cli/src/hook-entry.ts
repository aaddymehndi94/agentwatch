// The hook client agents run on every event: `node hook.mjs <agent>` with the hook JSON on stdin.
// Contract: ALWAYS exit 0, print nothing unless the daemon returned a decision, never block an agent when the
// daemon is down (≈1 s worst case), start the daemon if it isn't running. Node builtins only, for fast startup.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from './paths.ts'

const HOLD_EVENTS = new Set(['PermissionRequest'])
const CONNECT_TIMEOUT_MS = 800
const RESPONSE_TIMEOUT_MS = 4000
const SPAWN_WAIT_MS = 600

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  let data = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) data += chunk
  return data
}

function post(socket: string, urlPath: string, body: string, hold: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: socket,
        path: urlPath,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let out = ''
        res.setEncoding('utf8')
        res.on('data', (c) => (out += c))
        res.on('end', () => resolve(res.statusCode === 200 ? out : ''))
        res.on('error', reject)
      },
    )
    const connectTimer = setTimeout(() => req.destroy(new Error('connect timeout')), CONNECT_TIMEOUT_MS)
    req.on('socket', (s) => s.on('connect', () => clearTimeout(connectTimer)))
    if (!hold) req.setTimeout(RESPONSE_TIMEOUT_MS, () => req.destroy(new Error('response timeout')))
    req.on('error', (e) => {
      clearTimeout(connectTimer)
      reject(e)
    })
    req.end(body)
  })
}

function startDaemon(): void {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const main = path.join(here, 'agentwatch.mjs')
  if (!fs.existsSync(main)) return
  const child = spawn(process.execPath, [main, 'daemon'], { detached: true, stdio: 'ignore', env: process.env })
  child.unref()
}

function accepts(socket: string): Promise<boolean> {
  return new Promise((resolve) => {
    const c = net.connect(socket)
    c.once('connect', () => {
      c.destroy()
      resolve(true)
    })
    c.once('error', () => resolve(false))
  })
}

async function main(): Promise<void> {
  const agent = process.argv[2] || 'claude'
  const body = await readStdin()
  let event = ''
  try {
    event = JSON.parse(body).hook_event_name ?? ''
  } catch {
    return
  }
  const p = paths()
  const hold = HOLD_EVENTS.has(event)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await post(p.socket, `/v1/hook/${agent}`, body, hold)
      if (out) process.stdout.write(out)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      // Not set up for this user: stay out of the way entirely.
      if (attempt === 0 && (code === 'ENOENT' || code === 'ECONNREFUSED') && fs.existsSync(p.configFile)) {
        startDaemon()
        // Give the fresh daemon up to SPAWN_WAIT_MS to start listening, then try once more. Wait for a connection, not
        // the socket file: a daemon that crashed leaves its file behind.
        const until = Date.now() + SPAWN_WAIT_MS
        while (Date.now() < until && !(await accepts(p.socket))) await new Promise((r) => setTimeout(r, 40))
        continue
      }
      return
    }
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0))
