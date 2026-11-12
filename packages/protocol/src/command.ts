// Building (device side) and verifying (source side) sealed commands.

import { open, randomId, seal } from './crypto.ts'
import { bind, CommandBody, type CommandEnvelope, type CommandKind } from './wire.ts'

export const COMMAND_MAX_SKEW_MS = 5 * 60 * 1000

export async function buildCommand(
  key: CryptoKey,
  args: { deviceId: string; sourceId: string; sessionId: string; requestId?: string; body: CommandBody; now?: number },
): Promise<CommandEnvelope> {
  const head = {
    commandId: randomId(),
    deviceId: args.deviceId,
    sourceId: args.sourceId,
    sessionId: args.sessionId,
    ...(args.requestId ? { requestId: args.requestId } : {}),
    kind: args.body.kind as CommandKind,
    ts: args.now ?? Date.now(),
    nonce: randomId(18),
  }
  return { ...head, sealed: await seal(key, args.body, bind.command(head)) }
}

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
