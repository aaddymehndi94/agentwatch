// Small append-only log with one rotation, so a long-running daemon never fills the disk.

import fs from 'node:fs'

const MAX_BYTES = 1024 * 1024

export type Logger = (level: 'info' | 'warn' | 'error' | 'debug', msg: string, extra?: Record<string, unknown>) => void

export function fileLogger(file: string, alsoStderr = false): Logger {
  let written = 0
  try {
    written = fs.statSync(file).size
  } catch {}
  return (level, msg, extra) => {
    if (level === 'debug' && !process.env.AGENTWATCH_DEBUG) return
    const line = `${new Date().toISOString()} ${level.padEnd(5)} ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}\n`
    if (alsoStderr) process.stderr.write(line)
    try {
      if (written + line.length > MAX_BYTES) {
        fs.renameSync(file, `${file}.1`)
        written = 0
      }
      fs.appendFileSync(file, line, { mode: 0o600 })
      written += line.length
    } catch {}
  }
}
