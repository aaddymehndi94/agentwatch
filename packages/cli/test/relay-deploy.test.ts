// `agentwatch relay deploy` runs the repo's own wrangler and vite. It can't run for real in tests (it needs a
// Cloudflare login), but finding those tools can be checked: wrangler 4 doesn't export its bin file.

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { packageBin } from '../src/commands/relay.ts'
import { CLI_DIR } from './harness.ts'

describe('relay deploy', () => {
  it('finds and runs the repo’s own wrangler and vite', () => {
    const relayDir = path.resolve(CLI_DIR, '../relay')
    const wrangler = packageBin(relayDir, 'wrangler')
    expect(wrangler).toMatch(/wrangler\.js$/)
    expect(execFileSync(process.execPath, [wrangler!, '--version'], { encoding: 'utf8' })).toMatch(/\d+\.\d+\.\d+/)
    expect(packageBin(path.resolve(CLI_DIR, '../app'), 'vite')).toMatch(/vite\.js$/)
    expect(packageBin(relayDir, 'no-such-package')).toBeNull()
  }, 30_000)
})
