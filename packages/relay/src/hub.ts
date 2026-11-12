// The Hub: the relay's single Durable Object. SQLite holds sources, sessions, requests, events, devices, push
// subscriptions, pairings and commands. Sources keep a hibernatable WebSocket open; devices use plain HTTPS.
// Nothing here can read sealed fields: the vault key never reaches the relay.

import { DurableObject } from 'cloudflare:workers'
import {
  CommandEnvelope,
  constantTimeEqual,
  PING,
  PONG,
  type RelayMessage,
  type RequestView,
  randomId,
  type SessionView,
  SourceMessage,
  type SourceView,
  type StateView,
  sha256Hex,
} from '@agentwatch/protocol'
import { z } from 'zod'
import { deliverPush, ensureVapid, type PushSubscriptionRow, rememberOrigin } from './push.ts'
import { migrate } from './schema.ts'

const PAIRING_TTL_MS = 10 * 60 * 1000
const ENDED_KEEP_MS = 3 * 24 * 60 * 60 * 1000
const CLOSED_REQUEST_KEEP_MS = 10 * 60 * 1000
const COMMAND_QUEUE_MS = 5 * 60 * 1000
const EVENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000
/** The daemon pings every 30 s; a socket with no ping for this long is dead even if it never closed. */
const STALE_MS = 90 * 1000
const OFFLINE_AFTER_MS = 10 * 60 * 1000
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000

type Role = 'source' | 'device'
interface Principal {
  role: Role
  id: string
}
interface Attachment {
  sourceId: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
const err = (status: number, error: string) => json({ error }, status)

export class Hub extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    ctx.blockConcurrencyWhile(async () => migrate(this.sql))
    // Keepalive without waking the object: the daemon sends "ping" every 30 s.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG))
  }

  // ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method
    try {
      if (path === '/api/health') return json({ ok: true, claimed: this.isClaimed() })
      if (path === '/api/claim' && method === 'POST') return await this.claim(request)
      if (path === '/api/pair/claim' && method === 'POST') return await this.claimPairing(request)
      if (path === '/api/source/ws') return await this.acceptSource(request)

      const who = await this.authenticate(request)
      if (!who) return err(401, 'unauthorized')
      if (who.role !== 'device') return err(403, 'devices only')
      this.touchDevice(who.id)
      rememberOrigin(this.sql, url)

      if (path === '/api/state' && method === 'GET') return json(this.stateView())
      let m = /^\/api\/sessions\/([^/]+)\/([^/]+)\/events$/.exec(path)
      if (m && method === 'GET') return json(this.events(decodeURIComponent(m[1]!), decodeURIComponent(m[2]!)))
      if (path === '/api/commands' && method === 'POST') return await this.postCommand(who.id, request)
      m = /^\/api\/commands\/([^/]+)$/.exec(path)
      if (m && method === 'GET') return this.getCommand(who.id, decodeURIComponent(m[1]!))
      if (path === '/api/devices' && method === 'GET') return json(this.devices(who.id))
      m = /^\/api\/devices\/([^/]+)$/.exec(path)
      if (m && method === 'DELETE') return this.revokeDevice(decodeURIComponent(m[1]!))
      if (path === '/api/push/vapid' && method === 'GET')
        return json({ publicKey: (await ensureVapid(this.sql)).publicKey })
      if (path === '/api/push/subscription' && method === 'POST') return await this.subscribe(who.id, request)
      if (path === '/api/push/subscription' && method === 'DELETE') return await this.unsubscribe(who.id, request)
      if (path === '/api/push/test' && method === 'POST') return await this.testPush(who.id)
      if (path === '/api/mute' && method === 'POST') return await this.setMute(request)
      return err(404, 'not found')
    } catch (e) {
      if (e instanceof z.ZodError) return err(400, 'invalid request')
      if (e instanceof HttpError) return err(e.status, e.message)
      console.error('hub error', e)
      return err(500, 'internal error')
    }
  }

  private isClaimed(): boolean {
    return this.sql.exec(`SELECT 1 FROM meta WHERE k = 'claimed'`).toArray().length > 0
  }

  private async issueToken(role: Role, subject: string): Promise<string> {
    const token = `aw_${role[0]}_${randomId(32)}`
    this.sql.exec(
      'INSERT INTO tokens (hash, role, subject, created_at) VALUES (?, ?, ?, ?)',
      await sha256Hex(token),
      role,
      subject,
      Date.now(),
    )
    return token
  }

  private async authenticate(request: Request): Promise<Principal | null> {
    const h = request.headers.get('authorization') ?? ''
    const token = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
    if (!token) return null
    const row = this.sql
      .exec<{ role: Role; subject: string }>('SELECT role, subject FROM tokens WHERE hash = ?', await sha256Hex(token))
      .toArray()[0]
    return row ? { role: row.role, id: row.subject } : null
  }

  /** First-run ownership: whoever knows the deploy-time CLAIM_SECRET gets the first source token. Works once. */
  private async claim(request: Request): Promise<Response> {
    const secret = this.env.CLAIM_SECRET
    if (!secret) return err(503, 'relay has no CLAIM_SECRET configured')
    const body = z.object({ claimSecret: z.string().min(16) }).parse(await request.json())
    if (!constantTimeEqual(body.claimSecret, secret)) return err(403, 'wrong claim secret')
    if (this.isClaimed()) return err(409, 'relay already claimed')
    const sourceId = randomId(12)
    this.sql.exec(`INSERT INTO meta (k, v) VALUES ('claimed', ?)`, String(Date.now()))
    this.insertSource(sourceId)
    return json({ sourceId, sourceToken: await this.issueToken('source', sourceId) })
  }

  private insertSource(id: string, meta: Record<string, string> = {}): void {
    this.sql.exec(
      `INSERT INTO sources (id, host, user, privacy, allow_messages, daemon_version, adapters, last_seen, created_at)
       VALUES (?, '', '', ?, ?, '', '{}', 0, ?)`,
      id,
      meta.privacy === 'summary' ? 'summary' : 'full',
      meta.allowMessages === 'false' ? 0 : 1,
      Date.now(),
    )
  }

  /** One-time pairing claim: returns the wrapped vault key and a fresh device/source token, then forgets the pairing. */
  private async claimPairing(request: Request): Promise<Response> {
    const body = z
      .object({ pairId: z.string().min(8).max(64), name: z.string().max(100).optional() })
      .parse(await request.json())
    const row = this.sql
      .exec<{ kind: string; wrapped: string; expires_at: number; meta: string }>(
        'SELECT kind, wrapped, expires_at, meta FROM pairings WHERE id = ?',
        body.pairId,
      )
      .toArray()[0]
    this.sql.exec('DELETE FROM pairings WHERE id = ? OR expires_at < ?', body.pairId, Date.now())
    if (!row || row.expires_at < Date.now()) return err(410, 'pairing expired or already used')
    if (row.kind === 'device') {
      const deviceId = randomId(12)
      this.sql.exec(
        'INSERT INTO devices (id, name, created_at, last_seen) VALUES (?, ?, ?, ?)',
        deviceId,
        body.name ?? 'Phone',
        Date.now(),
        Date.now(),
      )
      return json({
        kind: 'device',
        deviceId,
        deviceToken: await this.issueToken('device', deviceId),
        wrapped: row.wrapped,
      })
    }
    const sourceId = randomId(12)
    const meta = JSON.parse(row.meta || '{}') as Record<string, string>
    this.insertSource(sourceId, meta)
    return json({
      kind: 'source',
      sourceId,
      sourceToken: await this.issueToken('source', sourceId),
      wrapped: row.wrapped,
      meta,
    })
  }

  // ── Sources (WebSocket) ──────────────────────────────────────────────────────────────────────────────────────────

  private async acceptSource(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return err(426, 'expected websocket')
    const who = await this.authenticate(request)
    if (who?.role !== 'source') return err(401, 'unauthorized')
    // One live socket per source: a reconnect replaces the old one.
    for (const old of this.ctx.getWebSockets(who.id)) old.close(4000, 'replaced')
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]
    this.ctx.acceptWebSocket(server, [who.id])
    server.serializeAttachment({ sourceId: who.id } satisfies Attachment)
    const now = Date.now()
    this.sql.exec('UPDATE sources SET last_seen = ?, offline_notified = 0 WHERE id = ?', now, who.id)
    await this.scheduleAlarm(now + this.offlineAfterMs())
    this.send(server, { t: 'welcome', sourceId: who.id, serverTime: now, mute: this.mute() })
    this.flushCommands(who.id, server)
    return new Response(null, { status: 101, webSocket: client })
  }

  private send(ws: WebSocket, msg: RelayMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      /* socket already gone */
    }
  }

  private sourceSocket(sourceId: string): WebSocket | undefined {
    return this.ctx.getWebSockets(sourceId)[0]
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const { sourceId } = ws.deserializeAttachment() as Attachment
    if (typeof raw !== 'string' || raw === PING) return
    let msg: SourceMessage
    try {
      msg = SourceMessage.parse(JSON.parse(raw))
    } catch {
      this.send(ws, { t: 'error', error: 'invalid message' })
      return
    }
    const now = Date.now()
    this.sql.exec('UPDATE sources SET last_seen = ? WHERE id = ?', now, sourceId)
    switch (msg.t) {
      case 'hello':
        this.sql.exec(
          `UPDATE sources SET host = ?, user = ?, privacy = ?, allow_messages = ?, daemon_version = ?, adapters = ?
           WHERE id = ?`,
          msg.host,
          msg.user,
          msg.privacy,
          msg.allowMessages ? 1 : 0,
          msg.daemonVersion,
          JSON.stringify(msg.adapters),
          sourceId,
        )
        break
      case 'snapshot': {
        const ids = new Set(msg.sessions.map((s) => s.id))
        for (const s of msg.sessions) this.upsertSession(sourceId, s)
        for (const row of this.sql
          .exec<{ id: string }>(`SELECT id FROM sessions WHERE source_id = ? AND state != 'ended'`, sourceId)
          .toArray()) {
          if (!ids.has(row.id))
            this.sql.exec(
              `UPDATE sessions SET state = 'ended', state_since = ?, updated_at = ? WHERE source_id = ? AND id = ?`,
              now,
              now,
              sourceId,
              row.id,
            )
        }
        const reqIds = new Set(msg.requests.map((r) => r.id))
        for (const r of msg.requests) this.upsertRequest(sourceId, r)
        for (const row of this.sql
          .exec<{ id: string }>(`SELECT id FROM requests WHERE source_id = ? AND status = 'open'`, sourceId)
          .toArray()) {
          if (!reqIds.has(row.id))
            this.sql.exec(`UPDATE requests SET status = 'expired', closed_at = ? WHERE id = ?`, now, row.id)
        }
        break
      }
      case 'session':
        this.upsertSession(sourceId, msg.session)
        break
      case 'event':
        this.sql.exec(
          'INSERT INTO events (source_id, session_id, at, kind, sealed) VALUES (?, ?, ?, ?, ?)',
          sourceId,
          msg.event.sessionId,
          msg.event.at,
          msg.event.kind,
          msg.event.sealed ?? null,
        )
        break
      case 'request.open':
        this.upsertRequest(sourceId, msg.request)
        break
      case 'request.close':
        this.sql.exec(
          `UPDATE requests SET status = ?, closed_at = ? WHERE id = ? AND source_id = ? AND status = 'open'`,
          msg.status,
          msg.at,
          msg.requestId,
          sourceId,
        )
        break
      case 'push': {
        // A test push is something you asked for just now, so it goes through even while muted.
        const muted = msg.push.kind !== 'test' && this.mute() !== null
        const delivery = muted
          ? Promise.resolve(null)
          : deliverPush(
              this.sql,
              this.env,
              {
                v: 1,
                tag: msg.push.tag,
                kind: msg.push.kind,
                sourceId,
                sessionId: msg.push.sessionId,
                requestId: msg.push.requestId,
                actions: msg.push.actions,
                sealed: msg.push.sealed,
              },
              msg.push.urgency,
            )
        if (msg.rid) {
          const rid = msg.rid
          this.ctx.waitUntil(
            delivery.then((r) =>
              this.send(ws, {
                t: 'ack',
                rid,
                ok: !!r && r.sent > 0,
                ...(muted
                  ? { error: 'notifications are muted' }
                  : !r || r.sent === 0
                    ? { error: r?.failed ? 'the push service refused it' : 'no phone has notifications on' }
                    : {}),
              }),
            ),
          )
        } else this.ctx.waitUntil(delivery)
        break
      }
      case 'mute':
        this.applyMute(msg.until)
        break
      case 'command.ack':
        this.sql.exec(
          'UPDATE commands SET status = ?, detail = ?, updated_at = ? WHERE id = ? AND source_id = ?',
          msg.status,
          msg.detail ?? null,
          now,
          msg.commandId,
          sourceId,
        )
        break
      case 'pair.create':
        this.sql.exec(
          'INSERT OR REPLACE INTO pairings (id, kind, wrapped, source_id, expires_at, meta) VALUES (?, ?, ?, ?, ?, ?)',
          msg.pairId,
          msg.kind,
          msg.wrapped,
          sourceId,
          Math.min(msg.expiresAt, now + PAIRING_TTL_MS),
          JSON.stringify(msg.meta ?? {}),
        )
        this.send(ws, { t: 'ack', rid: msg.rid, ok: true })
        break
      case 'rotate':
        this.rotate(sourceId)
        this.send(ws, { t: 'ack', rid: msg.rid, ok: true })
        break
    }
  }

  /**
   * A new vault key: everyone else who holds the old one (every phone, every other source) is signed out, and what was
   * sealed with it (sessions, requests, the timeline, queued commands, open invites) is unreadable, so it goes too.
   * The owner, VAPID keys and mute stay. The rotating source re-sends its sessions under the new key.
   */
  private rotate(keep: string): void {
    const others = this.sql
      .exec<{ id: string }>('SELECT id FROM sources WHERE id != ?', keep)
      .toArray()
      .map((r) => r.id)
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM tokens WHERE role = 'device' OR (role = 'source' AND subject != ?)`, keep)
      for (const table of ['push_subs', 'devices', 'pairings', 'commands', 'events', 'requests', 'sessions'])
        this.sql.exec(`DELETE FROM ${table}`)
      this.sql.exec('DELETE FROM sources WHERE id != ?', keep)
    })
    for (const id of others) for (const ws of this.ctx.getWebSockets(id)) ws.close(4003, 'revoked')
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const { sourceId } = ws.deserializeAttachment() as Attachment
    const now = Date.now()
    this.sql.exec('UPDATE sources SET last_seen = ? WHERE id = ?', now, sourceId)
    await this.scheduleAlarm(now + this.offlineAfterMs())
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye')
    } catch {
      /* already closed */
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 1011)
  }

  private upsertSession(sourceId: string, s: SessionView | Omit<SessionView, 'sourceId'>): void {
    this.sql.exec(
      `INSERT INTO sessions (source_id, id, agent, state, state_since, started_at, turn_started_at, updated_at, caps, sealed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_id, id) DO UPDATE SET agent = excluded.agent, state = excluded.state,
         state_since = excluded.state_since, started_at = excluded.started_at, turn_started_at = excluded.turn_started_at,
         updated_at = excluded.updated_at, caps = excluded.caps, sealed = excluded.sealed`,
      sourceId,
      s.id,
      s.agent,
      s.state,
      s.stateSince,
      s.startedAt,
      s.turnStartedAt,
      s.updatedAt,
      JSON.stringify(s.caps),
      s.sealed ?? null,
    )
  }

  private upsertRequest(sourceId: string, r: Omit<RequestView, 'sourceId'>): void {
    this.sql.exec(
      `INSERT INTO requests (id, source_id, session_id, kind, created_at, status, closed_at, answerable, sealed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET status = excluded.status, closed_at = excluded.closed_at,
         answerable = excluded.answerable, sealed = excluded.sealed`,
      r.id,
      sourceId,
      r.sessionId,
      r.kind,
      r.createdAt,
      r.status,
      r.closedAt ?? null,
      r.answerable ? 1 : 0,
      r.sealed,
    )
  }

  // ── Offline alert and housekeeping (alarm) ───────────────────────────────────────────────────────────────────────

  private offlineAfterMs(): number {
    const s = Number(this.env.OFFLINE_AFTER_SECONDS)
    return Number.isFinite(s) && s > 0 ? s * 1000 : OFFLINE_AFTER_MS
  }

  private async scheduleAlarm(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current > at) await this.ctx.storage.setAlarm(at)
  }

  /** Last auto-answered ping (pings don't wake the object, so they never touch last_seen). */
  private lastPing(sourceId: string): number {
    const ws = this.sourceSocket(sourceId)
    return ws ? (this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0) : 0
  }

  private isOnline(sourceId: string, lastSeen: number, now: number): boolean {
    return !!this.sourceSocket(sourceId) && now - Math.max(lastSeen, this.lastPing(sourceId)) < STALE_MS
  }

  /**
   * One "offline" push per outage: a source that has been silent for 10 minutes while an agent was working or waiting
   * on you. A laptop that sleeps with idle agents stays quiet. Then prune what nobody will look at again.
   */
  override async alarm(): Promise<void> {
    const now = Date.now()
    const after = this.offlineAfterMs()
    let next = now + PRUNE_EVERY_MS
    const sources = this.sql
      .exec<{ id: string; host: string; user: string; last_seen: number; offline_notified: number }>(
        'SELECT id, host, user, last_seen, offline_notified FROM sources',
      )
      .toArray()
    for (const src of sources) {
      const heard = Math.max(src.last_seen, this.lastPing(src.id))
      const ws = this.sourceSocket(src.id)
      if (ws && now - heard < STALE_MS) {
        next = Math.min(next, now + after)
        continue
      }
      if (ws) {
        // Half-open socket (the laptop slept or lost its network): drop it so the phone shows it offline.
        try {
          ws.close(4001, 'no ping')
        } catch {}
      }
      if (src.offline_notified) continue
      if (now - heard < after) {
        next = Math.min(next, heard + after)
        continue
      }
      this.sql.exec('UPDATE sources SET offline_notified = 1 WHERE id = ?', src.id)
      const active =
        this.sql
          .exec<{ n: number }>(
            `SELECT COUNT(*) AS n FROM sessions WHERE source_id = ? AND state IN ('working', 'needs_you')`,
            src.id,
          )
          .toArray()[0]?.n ?? 0
      if (!active || this.mute() !== null) continue
      const who = src.user && src.host ? `${src.user}@${src.host}` : 'A computer'
      const minutes = Math.max(1, Math.round((now - heard) / 60_000))
      await deliverPush(
        this.sql,
        this.env,
        {
          v: 1,
          tag: `offline:${src.id}`,
          kind: 'offline',
          sourceId: src.id,
          title: `${who} went offline`,
          body: `${active === 1 ? 'An agent was' : `${active} agents were`} running. Last heard from ${minutes} min ago.`,
        },
        'normal',
      ).catch((e) => console.error('offline push failed', e))
    }
    this.prune(now)
    await this.ctx.storage.setAlarm(next)
  }

  private prune(now: number): void {
    this.sql.exec(`DELETE FROM sessions WHERE state = 'ended' AND state_since < ?`, now - ENDED_KEEP_MS)
    this.sql.exec(`DELETE FROM requests WHERE status != 'open' AND closed_at < ?`, now - ENDED_KEEP_MS)
    this.sql.exec('DELETE FROM events WHERE at < ?', now - EVENT_KEEP_MS)
    this.sql.exec('DELETE FROM commands WHERE updated_at < ?', now - PRUNE_EVERY_MS)
    this.sql.exec('DELETE FROM pairings WHERE expires_at < ?', now)
  }

  // ── Devices ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private touchDevice(id: string): void {
    this.sql.exec('UPDATE devices SET last_seen = ? WHERE id = ?', Date.now(), id)
  }

  private mute(): number | null {
    const row = this.sql.exec<{ v: string }>(`SELECT v FROM meta WHERE k = 'mute_until'`).toArray()[0]
    const until = row ? Number(row.v) : 0
    return until > Date.now() ? until : null
  }

  private stateView(): StateView {
    const now = Date.now()
    const sources: SourceView[] = this.sql
      .exec<{
        id: string
        host: string
        user: string
        privacy: string
        allow_messages: number
        daemon_version: string
        adapters: string
        last_seen: number
      }>(
        'SELECT id, host, user, privacy, allow_messages, daemon_version, adapters, last_seen FROM sources ORDER BY created_at',
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        host: r.host,
        user: r.user,
        privacy: r.privacy === 'summary' ? 'summary' : 'full',
        allowMessages: r.allow_messages === 1,
        online: this.isOnline(r.id, r.last_seen, now),
        lastSeen: Math.max(r.last_seen, this.lastPing(r.id)),
        daemonVersion: r.daemon_version,
        adapters: JSON.parse(r.adapters || '{}'),
      }))
    const sessions: SessionView[] = this.sql
      .exec<{
        source_id: string
        id: string
        agent: SessionView['agent']
        state: SessionView['state']
        state_since: number
        started_at: number
        turn_started_at: number | null
        updated_at: number
        caps: string
        sealed: string | null
      }>(
        `SELECT * FROM sessions WHERE state != 'ended' OR state_since > ? ORDER BY updated_at DESC`,
        now - ENDED_KEEP_MS,
      )
      .toArray()
      .map((r) => ({
        sourceId: r.source_id,
        id: r.id,
        agent: r.agent,
        state: r.state,
        stateSince: r.state_since,
        startedAt: r.started_at,
        turnStartedAt: r.turn_started_at,
        updatedAt: r.updated_at,
        caps: JSON.parse(r.caps),
        ...(r.sealed ? { sealed: r.sealed } : {}),
      }))
    const requests: RequestView[] = this.sql
      .exec<{
        id: string
        source_id: string
        session_id: string
        kind: RequestView['kind']
        created_at: number
        status: RequestView['status']
        closed_at: number | null
        answerable: number
        sealed: string
      }>(
        `SELECT * FROM requests WHERE status = 'open' OR closed_at > ? ORDER BY created_at DESC`,
        now - CLOSED_REQUEST_KEEP_MS,
      )
      .toArray()
      .map((r) => ({
        id: r.id,
        sourceId: r.source_id,
        sessionId: r.session_id,
        kind: r.kind,
        createdAt: r.created_at,
        status: r.status,
        closedAt: r.closed_at,
        answerable: r.answerable === 1,
        sealed: r.sealed,
      }))
    return { serverTime: now, mute: this.mute(), sources, sessions, requests }
  }

  private events(sourceId: string, sessionId: string) {
    return this.sql
      .exec<{ at: number; kind: string; sealed: string | null }>(
        'SELECT at, kind, sealed FROM events WHERE source_id = ? AND session_id = ? ORDER BY at DESC LIMIT 50',
        sourceId,
        sessionId,
      )
      .toArray()
      .map((e) => ({ sessionId, at: e.at, kind: e.kind, ...(e.sealed ? { sealed: e.sealed } : {}) }))
  }

  private async postCommand(deviceId: string, request: Request): Promise<Response> {
    const env = CommandEnvelope.parse(await request.json())
    if (env.deviceId !== deviceId) return err(403, 'device mismatch')
    const src = this.sql.exec('SELECT 1 FROM sources WHERE id = ?', env.sourceId).toArray()
    if (!src.length) return err(404, 'unknown source')
    const now = Date.now()
    const ws = this.sourceSocket(env.sourceId)
    const status = ws ? 'sent' : 'queued'
    this.sql.exec(
      `INSERT INTO commands (id, device_id, source_id, envelope, status, detail, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
      env.commandId,
      deviceId,
      env.sourceId,
      JSON.stringify(env),
      status,
      now,
      now,
    )
    if (ws) this.send(ws, { t: 'command', command: env })
    return json({ commandId: env.commandId, status }, 202)
  }

  private flushCommands(sourceId: string, ws: WebSocket): void {
    const now = Date.now()
    const rows = this.sql
      .exec<{ id: string; envelope: string }>(
        `SELECT id, envelope FROM commands WHERE source_id = ? AND status = 'queued' AND created_at > ? ORDER BY created_at`,
        sourceId,
        now - COMMAND_QUEUE_MS,
      )
      .toArray()
    for (const r of rows) {
      this.send(ws, { t: 'command', command: JSON.parse(r.envelope) })
      this.sql.exec(`UPDATE commands SET status = 'sent', updated_at = ? WHERE id = ?`, now, r.id)
    }
    this.sql.exec(
      `UPDATE commands SET status = 'expired', updated_at = ? WHERE source_id = ? AND status = 'queued'`,
      now,
      sourceId,
    )
  }

  private getCommand(deviceId: string, id: string): Response {
    const row = this.sql
      .exec<{ status: string; detail: string | null }>(
        'SELECT status, detail FROM commands WHERE id = ? AND device_id = ?',
        id,
        deviceId,
      )
      .toArray()[0]
    if (!row) return err(404, 'unknown command')
    return json({ commandId: id, status: row.status, ...(row.detail ? { detail: row.detail } : {}) })
  }

  private devices(selfId: string) {
    return this.sql
      .exec<{ id: string; name: string; created_at: number; last_seen: number }>(
        'SELECT id, name, created_at, last_seen FROM devices ORDER BY created_at',
      )
      .toArray()
      .map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeen: d.last_seen, self: d.id === selfId }))
  }

  private revokeDevice(id: string): Response {
    this.sql.exec(`DELETE FROM tokens WHERE role = 'device' AND subject = ?`, id)
    this.sql.exec('DELETE FROM push_subs WHERE device_id = ?', id)
    this.sql.exec('DELETE FROM devices WHERE id = ?', id)
    return json({ ok: true })
  }

  // ── Push ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  private async subscribe(deviceId: string, request: Request): Promise<Response> {
    const sub = z
      .object({
        endpoint: z.string().url().max(1000),
        keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
      })
      .parse(await request.json())
    const insecureOk =
      this.env.ALLOW_INSECURE_PUSH === '1' && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(sub.endpoint)
    if (!sub.endpoint.startsWith('https://') && !insecureOk) return err(400, 'push endpoint must be https')
    this.sql.exec(
      `INSERT INTO push_subs (endpoint, device_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (endpoint) DO UPDATE SET device_id = excluded.device_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      sub.endpoint,
      deviceId,
      sub.keys.p256dh,
      sub.keys.auth,
      Date.now(),
    )
    return json({ ok: true })
  }

  private async unsubscribe(deviceId: string, request: Request): Promise<Response> {
    const { endpoint } = z.object({ endpoint: z.string() }).parse(await request.json())
    this.sql.exec('DELETE FROM push_subs WHERE endpoint = ? AND device_id = ?', endpoint, deviceId)
    return json({ ok: true })
  }

  private async testPush(deviceId: string): Promise<Response> {
    const subs = this.sql
      .exec<PushSubscriptionRow>(
        'SELECT endpoint, device_id, p256dh, auth FROM push_subs WHERE device_id = ?',
        deviceId,
      )
      .toArray()
    if (!subs.length) return err(409, 'this device has no push subscription')
    const result = await deliverPush(
      this.sql,
      this.env,
      { v: 1, tag: 'test', kind: 'test', title: 'AgentWatch test', body: 'Notifications work on this device.' },
      'normal',
      subs,
    )
    return json(result)
  }

  private async setMute(request: Request): Promise<Response> {
    const { until } = z.object({ until: z.number().int().nonnegative().nullable() }).parse(await request.json())
    return json({ mute: this.applyMute(until) })
  }

  private applyMute(until: number | null): number | null {
    if (until && until > Date.now())
      this.sql.exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('mute_until', ?)`, String(until))
    else this.sql.exec(`DELETE FROM meta WHERE k = 'mute_until'`)
    const mute = this.mute()
    for (const ws of this.ctx.getWebSockets()) this.send(ws, { t: 'settings', mute })
    return mute
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
