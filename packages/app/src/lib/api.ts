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

export async function api<T>(token: string | null, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'Can’t reach your relay. Check your connection.')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
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

export const getState = (token: string) => api<StateView>(token, 'GET', '/api/state')
export const getEvents = (token: string, sourceId: string, sessionId: string) =>
  api<{ sessionId: string; at: number; kind: string; sealed?: string }[]>(
    token,
    'GET',
    `/api/sessions/${encodeURIComponent(sourceId)}/${encodeURIComponent(sessionId)}/events`,
  )
