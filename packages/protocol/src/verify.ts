// Verifying sealed commands on the source (daemon side).

import { bind } from './bind.ts'
import { COMMAND_MAX_SKEW_MS } from './command.ts'
import { open } from './crypto.ts'
import { CommandBody, type CommandEnvelope } from './wire.ts'

export type VerifyResult = { ok: true; body: CommandBody } | { ok: false; reason: string }

/**
 * Verify a command on the source. `seenNonce` must record the nonce and return true if it was already seen.
 * `notBefore` is the daemon's start time: commands older than that are rejected because the nonce cache
 * does not survive a restart.
 */
export async function verifyCommand(
  key: CryptoKey,
  env: CommandEnvelope,
  opts: { sourceId: string; now?: number; notBefore: number; seenNonce: (nonce: string) => boolean },
): Promise<VerifyResult> {
  const now = opts.now ?? Date.now()
  if (env.sourceId !== opts.sourceId) return { ok: false, reason: 'wrong source' }
  if (Math.abs(now - env.ts) > COMMAND_MAX_SKEW_MS) return { ok: false, reason: 'expired' }
  if (env.ts < opts.notBefore) return { ok: false, reason: 'expired' }
  let body: CommandBody
  try {
    const { sealed, ...head } = env
    body = CommandBody.parse(await open(key, sealed, bind.command(head)))
  } catch {
    return { ok: false, reason: 'bad seal' }
  }
  if (body.kind !== env.kind) return { ok: false, reason: 'kind mismatch' }
  if ((body.kind === 'decide' || body.kind === 'answer') && !env.requestId) return { ok: false, reason: 'no request' }
  if (opts.seenNonce(env.nonce)) return { ok: false, reason: 'replay' }
  return { ok: true, body }
}
