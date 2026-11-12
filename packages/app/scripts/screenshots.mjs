// Screenshots of every screen and state, at phone size (390×844, 2×) in light and dark, into docs/screenshots/.
// Uses the `?demo` fixtures, so no relay is needed: `pnpm --filter @agentwatch/app screenshots`.
// Needs Chrome or Chromium (set CHROME=/path/to/chrome if it isn't on PATH). Drives it over the DevTools protocol with
// real phone emulation, so the viewport is exactly the phone's, and with reduced motion so every frame is at rest.

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const outDir = path.resolve(appDir, '../../docs/screenshots')
const PORT = 4179
const DEBUG_PORT = 9339

const SHOTS = [
  ['inbox', '?demo'],
  ['inbox-calm', '?demo=calm'],
  ['inbox-offline', '?demo=offline'],
  ['session-approval', '?demo#/s/laptop-a/s1'],
  ['session-reply', '?demo#/s/laptop-a/s4'],
  ['session-working', '?demo#/s/laptop-a/s3'],
  ['settings', '?demo#/settings'],
  ['pair', '?'],
]

function findChrome() {
  const candidates = [process.env.CHROME, 'google-chrome', 'chromium', 'chromium-browser', 'chrome'].filter(Boolean)
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' })
      return c
    } catch {}
  }
  throw new Error('Chrome or Chromium not found; set CHROME=/path/to/chrome')
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await sleep(200)
  }
  throw new Error(`server did not start at ${url}`)
}

/** A minimal DevTools protocol client over Node's built-in WebSocket. */
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve)
    ws.addEventListener('error', reject)
  })
  let id = 0
  const waiting = new Map()
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data)
    const done = waiting.get(msg.id)
    if (!done) return
    waiting.delete(msg.id)
    if (msg.error) done.reject(new Error(msg.error.message))
    else done.resolve(msg.result)
  })
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const n = ++id
      waiting.set(n, { resolve, reject })
      ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  return { send, close: () => ws.close() }
}

const chromePath = findChrome()
const vite = path.join(appDir, 'node_modules/vite/bin/vite.js')
execFileSync(process.execPath, [vite, 'build'], { cwd: appDir, stdio: 'inherit' })
const preview = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: appDir,
  stdio: 'ignore',
})
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-shot-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)
try {
  await waitFor(`http://localhost:${PORT}/`)
  await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json()
  const cdp = await connect(webSocketDebuggerUrl)
  fs.mkdirSync(outDir, { recursive: true })
  for (const theme of ['light', 'dark']) {
    for (const [name, query] of SHOTS) {
      const [search, hash = ''] = query.split('#')
      const url = `http://localhost:${PORT}/${search}${search.length > 1 ? '&' : ''}theme=${theme}${hash ? `#${hash}` : ''}`
      // A fresh browser context per shot: no stored pairing, so `?` without demo is the first-run pair screen.
      const { browserContextId } = await cdp.send('Target.createBrowserContext')
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId })
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
      const s = (method, params) => cdp.send(method, params, sessionId)
      await s('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true })
      await s('Emulation.setTouchEmulationEnabled', { enabled: true })
      await s('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-color-scheme', value: theme },
          { name: 'prefers-reduced-motion', value: 'reduce' },
        ],
      })
      await s('Page.enable')
      await s('Page.navigate', { url })
      await sleep(2500)
      const { data } = await s('Page.captureScreenshot', { format: 'png' })
      const file = path.join(outDir, `${name}-${theme}.png`)
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      await cdp.send('Target.closeTarget', { targetId })
      await cdp.send('Target.disposeBrowserContext', { browserContextId })
      console.log(path.relative(process.cwd(), file))
    }
  }
  cdp.close()
} finally {
  chrome.kill()
  preview.kill()
  await sleep(300)
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
