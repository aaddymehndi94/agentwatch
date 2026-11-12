// Screenshots of every screen and state, at phone size (390×844, 2×) in light and dark, into docs/screenshots/.
// Uses the `?demo` fixtures, so no relay is needed: `pnpm --filter @agentwatch/app screenshots`.
// Needs Chrome or Chromium (set CHROME=/path/to/chrome if it isn't on PATH).

import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const appDir = path.resolve(here, '..')
const outDir = path.resolve(appDir, '../../docs/screenshots')
const PORT = 4179

const SHOTS = [
  ['inbox', '?demo'],
  ['inbox-calm', '?demo=calm'],
  ['inbox-offline', '?demo=offline'],
  ['session-approval', '?demo#/s/laptop-a/s1'],
  ['session-reply', '?demo#/s/laptop-a/s4'],
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

async function waitFor(url) {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`preview server did not start at ${url}`)
}

const chrome = findChrome()
const vite = path.join(appDir, 'node_modules/vite/bin/vite.js')
execFileSync(process.execPath, [vite, 'build'], { cwd: appDir, stdio: 'inherit' })
const preview = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: appDir,
  stdio: 'ignore',
})
try {
  await waitFor(`http://localhost:${PORT}/`)
  fs.mkdirSync(outDir, { recursive: true })
  for (const theme of ['light', 'dark']) {
    for (const [name, query] of SHOTS) {
      const [search, hash = ''] = query.split('#')
      const url = `http://localhost:${PORT}/${search}${search.length > 1 ? '&' : ''}theme=${theme}${hash ? `#${hash}` : ''}`
      // A fresh profile per shot: no stored pairing, so `?` without demo is the first-run pair screen.
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-shot-'))
      const file = path.join(outDir, `${name}-${theme}.png`)
      try {
        execFileSync(
          chrome,
          [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--no-first-run',
            `--user-data-dir=${profile}`,
            '--force-device-scale-factor=2',
            '--window-size=390,844',
            '--virtual-time-budget=4000',
            `--screenshot=${file}`,
            url,
          ],
          { stdio: 'ignore' },
        )
      } finally {
        fs.rmSync(profile, { recursive: true, force: true })
      }
      console.log(path.relative(process.cwd(), file))
    }
  }
} finally {
  preview.kill()
}
