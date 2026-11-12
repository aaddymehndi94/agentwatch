// Building (device side) and verifying (source side) sealed commands.

import { bind } from './bind.ts'
import { randomId, seal } from './crypto.ts'
import type { CommandBody, CommandEnvelope, CommandKind } from './wire.ts'

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
