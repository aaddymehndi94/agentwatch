// Per-user config (mode 0600). Holds the relay URL, this source's token and the vault key.

import fs from 'node:fs'
import path from 'node:path'
import { Privacy } from '@agentwatch/protocol'
import { z } from 'zod'
import { paths } from './paths.ts'

export const Config = z.object({
  v: z.literal(1).default(1),
  relayUrl: z.string().url(),
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
    })
    .default({ doneMinSeconds: 30, needsYouDelaySeconds: 10 }),
  claude: z
    .object({
      enabled: z.boolean().default(true),
      /** How long a PermissionRequest hook is held for the phone (the terminal dialog stays usable meanwhile). */
      holdSeconds: z
        .number()
        .int()
        .min(0)
        .default(11 * 3600),
      /** Poll `claude agents --json` (seconds; 0 = off). */
      pollSeconds: z.number().int().min(0).default(30),
    })
    .default({ enabled: true, holdSeconds: 11 * 3600, pollSeconds: 30 }),
  codex: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
})
export type Config = z.infer<typeof Config>

export function loadConfig(file = paths().configFile): Config | null {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
  return Config.parse(JSON.parse(raw))
}

export function saveConfig(cfg: Config, file = paths().configFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
  fs.chmodSync(file, 0o600)
}
