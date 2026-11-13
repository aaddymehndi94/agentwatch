// Per-user config (mode 0600). Holds the relay URL, this source's token and the vault key.

import fs from 'node:fs'
import path from 'node:path'
import { Privacy } from '@agentwatch/protocol'
import { z } from 'zod'
import { paths } from './paths.ts'

/**
 * A relay URL we will send a token to: https, or plain http only on this machine (local development). Over plain http
 * to anywhere else, the source token would cross the network in the clear.
 */
export function relayUrlProblem(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'is not a URL'
  }
  if (u.protocol === 'https:') return null
  if (u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return null
  return 'must start with https:// (plain http only works for localhost)'
}

export const Config = z.object({
  v: z.literal(1).default(1),
  relayUrl: z
    .string()
    .url()
    .refine((u) => relayUrlProblem(u) === null, { message: 'relay URL must be https (or http on localhost)' }),
  sourceId: z.string(),
  sourceToken: z.string(),
  vaultKey: z.string(),
  privacy: Privacy.default('full'),
  allowMessages: z.boolean().default(true),
  notify: z
    .object({
      /** Only turns at least this long push "done". */
      doneMinSeconds: z.number().int().min(0).default(30),
      /** Wait before pushing "needs you", so prompts answered at the keyboard don't buzz the phone. */
      needsYouDelaySeconds: z.number().int().min(0).default(10),
      /** Push once when a Claude or Codex rate-limit window reaches this percent (0 turns it off). */
      limitPercent: z.number().int().min(0).max(100).default(90),
    })
    .default({ doneMinSeconds: 30, needsYouDelaySeconds: 10, limitPercent: 90 }),
  claude: z
    .object({
      enabled: z.boolean().default(true),
      /** How long a PermissionRequest hook is held for the phone (the terminal dialog stays usable meanwhile). */
      holdSeconds: z
        .number()
        .int()
        .min(0)
        .default(11 * 3600),
    })
    .default({ enabled: true, holdSeconds: 11 * 3600 }),
  codex: z
    .object({
      enabled: z.boolean().default(true),
      /** How long a Codex approval or question stays answerable on the phone (the TUI can answer it meanwhile). */
      holdSeconds: z
        .number()
        .int()
        .min(0)
        .default(11 * 3600),
    })
    .default({ enabled: true, holdSeconds: 11 * 3600 }),
})
export type Config = z.infer<typeof Config>

export function loadConfig(file = paths().configFile): Config | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  // A config from another account (reached through a leaked HOME or XDG_CONFIG_HOME) would send this user's agents to
  // their relay, sealed with their key.
  if (fs.statSync(file).uid !== process.getuid?.()) throw new Error(`${file} belongs to another user; not using it`)
  return Config.parse(JSON.parse(raw))
}

export function saveConfig(cfg: Config, file = paths().configFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
  fs.chmodSync(file, 0o600)
}
