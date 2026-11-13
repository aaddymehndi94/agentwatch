// The relay's device API. Same origin: the relay serves this app.

import type { StateView } from '@agentwatch/protocol'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * How long a read may take. A phone that slept or switched networks can leave a request hanging on a dead connection
 * forever; without a limit, polling stops and the app keeps showing old state as if it were live.
 */
export const READ_TIMEOUT_MS = 15_000

export async function api<T>(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const ctl = new AbortController()
  const timer = timeoutMs ? setTimeout(() => ctl.abort(), timeoutMs) : undefined
  let res: Response
  let data: { error?: string }
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: ctl.signal,
    })
    data = (await res.json().catch((e: unknown) => {
      if (ctl.signal.aborted) throw e
      return {}
    })) as { error?: string }
  } catch {
    throw new ApiError(0, 'Can’t reach your relay. Check your connection.')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'This phone is no longer paired with the relay.'
        : (data.error ?? `The relay answered ${res.status}.`)
    throw new ApiError(res.status, msg)
  }
  return data as T
}

export interface DeviceInfo {
  id: string
  name: string
  createdAt: number
  lastSeen: number
  self: boolean
}

export const getState = (token: string) => api<StateView>(token, 'GET', '/api/state', undefined, READ_TIMEOUT_MS)
export const getEvents = (token: string, sourceId: string, sessionId: string) =>
  api<{ sessionId: string; at: number; kind: string; sealed?: string }[]>(
    token,
    'GET',
    `/api/sessions/${encodeURIComponent(sourceId)}/${encodeURIComponent(sessionId)}/events`,
    undefined,
    READ_TIMEOUT_MS,
  )
