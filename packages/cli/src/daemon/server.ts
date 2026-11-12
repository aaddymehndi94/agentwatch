// The daemon's local API: HTTP over a unix socket in a 0700 directory, so only this OS user can reach it.

import http from 'node:http'
import type { Logger } from '../log.ts'

export type Handler = (ctx: {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  /** Aborts when the client disconnects before we answer (e.g. a held hook was killed). */
  signal: AbortSignal
}) => Promise<{ status: number; body?: unknown; text?: string }>

const MAX_BODY = 4 * 1024 * 1024

export function createLocalServer(handler: Handler, log: Logger): http.Server {
  const server = http.createServer(async (req, res) => {
    const ac = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) ac.abort()
    })
    try {
      const raw = await readBody(req)
      let body: unknown = null
      if (raw) {
        try {
          body = JSON.parse(raw)
        } catch {
          return send(res, 400, { error: 'invalid JSON' })
        }
      }
      const url = new URL(req.url ?? '/', 'http://agentwatchd')
      const out = await handler({
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        body,
        signal: ac.signal,
      })
      if (out.text !== undefined) {
        res.writeHead(out.status, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(out.text)
      } else send(res, out.status, out.body)
    } catch (e) {
      log('error', 'local API error', { error: String(e) })
      if (!res.headersSent) send(res, 500, { error: 'internal error' })
      else res.destroy()
    }
  })
  // Held hooks can wait for hours: never time out a request that has been fully received.
  server.requestTimeout = 0
  server.timeout = 0
  server.keepAliveTimeout = 5000
  return server
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  if (body === undefined) {
    res.writeHead(status)
    res.end()
    return
  }
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}
