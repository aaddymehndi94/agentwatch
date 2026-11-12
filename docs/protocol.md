# Protocol

What crosses the network between the three parties, and what each one can see. The schemas themselves live in
`packages/protocol/src/wire.ts` (zod), and that file is the source of truth if this page and the code ever disagree.

```
daemon (one per OS user) ══ WebSocket, source token ══▶ relay: Worker + Hub Durable Object ◀── HTTPS, device token ── phone (PWA)
                                                        relay ── Web Push ──▶ phone
```

- **Source:** one daemon, meaning one OS user on one computer. It connects out, so nothing listens on the computer.
- **Relay:** your own Cloudflare Worker plus one Durable Object (the Hub, with SQLite storage). It stores and forwards,
  but it can't read text or forge commands.
- **Device:** a paired phone, which polls the Hub while the app is open and gets Web Push otherwise.

Every message carries version 1 of the protocol: as `v: 1` in `hello` and in push payloads, and inside every sealed
item's associated data.

## What the relay sees

| In the clear | Sealed with the vault key |
| --- | --- |
| Random ids (source, session, request, command, device) | Session title, project, cwd, snippet, model |
| Agent kind (`claude`, `codex`, `generic`) | Request title, tool, detail, questions and options |
| Session state, request kind and status, timestamps | Timeline text |
| Host name, OS user, privacy setting, versions | Push title and body |
| Whether a session can take replies right now (and why not) | Every command: decision, answers, reply text |

Under `summary` privacy the daemon seals only the project folder name and model. Requests become "Question" or
"Use Bash", and the timeline and pushes carry no text at all.

## Crypto

- **Vault key:** 32 random bytes (AES-256-GCM), base64url. It lives in each source's `config.json` (mode `0600`) and in
  each phone's IndexedDB, and never reaches the relay.
- **Seal:** `base64url(iv[12] ‖ ciphertext ‖ tag[16])` of the JSON value.
- **Associated data:** the canonical JSON of a *binding*, with sorted keys, `v: 1` added and undefined values dropped.
  A sealed blob only opens under the exact binding it was sealed for, so the relay can't move a snippet from one
  request onto another, or replay a command against a different request.

| Binding | Fields |
| --- | --- |
| `session` | `sourceId, sessionId` |
| `request` | `sourceId, sessionId, requestId, rk` (request kind) |
| `event` | `sourceId, sessionId, at, ek` (event kind) |
| `push` | `sourceId, tag, pk` (push kind)`, sessionId, requestId, actions` |
| `command` | `commandId, deviceId, sourceId, sessionId, requestId, ck` (command kind)`, ts, nonce` |
| `pair` | `pairId` |

## Pairing

A pairing code is `<pairId>.<secret>`. It appears only in a link's `#fragment`, which browsers never send to the
relay: `https://<relay>/#/pair/<code>` for a phone, or `#/join/<code>` for another computer or OS user.

1. The source derives a wrapping key, `HKDF-SHA256(secret, salt = "", info = "agentwatch/pair/v1")`. It sends
   `pair.create {pairId, kind, wrapped: seal(wrapKey, {k: vaultKey}, {kind: 'pair', pairId}), expiresAt}`.
2. The new device or source calls `POST /api/pair/claim {pairId, name?}` and gets a token and `wrapped` back. The relay
   deletes the pairing on that first claim, or after 10 minutes.
3. It unwraps the vault key locally with the secret from the fragment.

The first source, the **owner**, gets its token from `POST /api/claim {claimSecret}`. The claim secret is set as a
Worker secret at deploy time by `agentwatch relay deploy`. Each secret works once (`409` after that). A claim with a
*different* secret, which only someone with your Cloudflare account can set, makes a new owner and signs out every
other source and device. That is how you recover from losing the owner computer.

Only the owner may send `pair.create` (for phones and for other sources) and `rotate`. Other sources get
`{ok: false, error}`. Every source holds the vault key, so a phone paired from another OS user could read and steer
this one's agents; the rule keeps a compromised OS user from getting a device token at all.

`rotate` replaces the vault key. The Hub then deletes every device and every other source with their tokens, all
pairings, and everything sealed under the old key. The rotating source reconnects and re-sends its state.

## Source ↔ relay: WebSocket

`wss://<relay>/api/source/ws`, with `Authorization: Bearer <source token>`. A new connection from the same source
replaces the old one. The daemon sends the text `ping` every 30 s and the Hub answers `pong` without waking up. A
socket that hasn't pinged for 90 s is closed. If a source is gone for 10 minutes while one of its sessions was working
or waiting on you, every phone gets a single "offline" push.

**Source → relay**

| `t` | Fields | Notes |
| --- | --- | --- |
| `hello` | `v, host, user, privacy, allowMessages, daemonVersion, adapters` | First, on every connect. `host` and `user` are kept from the first hello only, so a source can't rename itself later |
| `snapshot` | `sessions[], requests[]` | Right after `hello`. Open requests it doesn't list become `expired`, and missing sessions `ended`. |
| `session` | `session` | Upsert: clear state plus `sealed` info |
| `event` | `event {sessionId, at, kind, sealed?}` | Timeline: `prompted`, `needs_you`, `answered`, `done`, `ended`, `replied` |
| `request.open` | `request` | `kind`, `answerable`, and `sealed` info |
| `request.close` | `requestId, status, at` | `answered`, `answered_locally`, `expired`, `cancelled` |
| `push` | `push {tag, kind, urgency, sessionId?, requestId?, actions, sealed}`, optional `rid` | The Hub sends it as Web Push. With a `rid` it acks whether any phone got it. |
| `mute` | `until` | Owner-wide; `null` clears it |
| `command.ack` | `commandId, status, detail?` | `applied` or `rejected` (with a reason the phone shows). Queued while offline. |
| `pair.create` | `rid, pairId, kind, wrapped, expiresAt, meta?` | Acked |
| `rotate` | `rid` | Acked; see Pairing above |

**Relay → source**

| `t` | Fields |
| --- | --- |
| `welcome` | `sourceId, serverTime, mute` |
| `command` | `command` (a sealed envelope, below) |
| `settings` | `mute` |
| `ack` | `rid, ok, error?` |
| `error` | `error` |

Pushes, timeline events and command acks made while the link is down are queued for up to 10 minutes. Everything
else is state, and the next snapshot carries it.

## Phone ↔ relay: HTTPS

Every call carries `Authorization: Bearer <device token>`.

| Call | What |
| --- | --- |
| `GET /api/state` | Sources (with `online`), sessions, open and recent requests, mute |
| `GET /api/sessions/:source/:session/events` | The last 50 timeline events, newest first |
| `POST /api/commands` | A sealed command envelope. The answer is `{commandId, status}`, `202`. |
| `GET /api/commands/:id` | `queued`, `sent`, `applied`, `rejected` (with `detail`) or `expired` |
| `GET /api/devices`, `DELETE /api/devices/:id` | List or sign out phones |
| `GET /api/push/vapid` | The relay's VAPID public key |
| `POST`/`DELETE /api/push/subscription` | A Web Push subscription (`https` endpoints only) |
| `POST /api/push/test` | Send this phone a test notification |
| `POST /api/mute` | `{until}` |

Unauthenticated: `GET /api/health` (`{ok, claimed}`), `POST /api/claim` and `POST /api/pair/claim`.

## Commands

A command is `{commandId, deviceId, sourceId, sessionId, requestId?, kind, ts, nonce, sealed}`, where `sealed` holds:

- `decide`: `{behavior: 'allow' | 'deny', message?}`
- `answer`: `{answers: {<question>: <label>, …}}`, with several labels joined by `", "`
- `message`: `{text}`, a reply into an idle session

The relay queues a command for an offline source for 5 minutes. On reconnect it resends both queued commands and sent
ones that were never acked. The daemon answers a command id it has already seen with the same ack, so a resend is
never applied twice. It applies a new command only if every check passes:

- the seal opens under the command binding, and the sealed kind matches `kind`;
- `sourceId` is this source;
- `ts` is within ±5 minutes of the daemon's clock, and not before the daemon started;
- the nonce is new;
- the request is still open and answerable, and the command fits it: `decide` only for a permission, `answer` only
  for a question;
- for `message`: this source allows messages, the session is idle, and its adapter can deliver.

Anything else is acked `rejected`, with a reason the phone shows.

## Web Push

The Hub signs with VAPID (keys generated inside the Durable Object on first use) and encrypts per RFC 8291
(`aes128gcm`). The payload is:

```json
{ "v": 1, "tag": "req:…", "kind": "needs_you", "sourceId": "…", "sessionId": "…", "requestId": "…",
  "actions": true, "sealed": "…" }
```

The service worker opens `sealed` with the vault key under the `push` binding, which covers every clear field it acts
on. If it can't, for example on a phone that was signed out, it still shows a generic notification, because iOS
requires every push to show something. Pushes the relay makes itself (offline, test) carry clear `title` and `body`.
Pushes that share a `tag` replace each other. `needs_you` goes out at high urgency.

Android shows Approve and Deny on a notification only when the seal opened, `actions` is true, and `tag` is
`req:<requestId>`. The daemon sets `actions` only for a permission whose whole detail fits in the notification: one
line of at most 180 characters. Anything longer is approved in the app, which shows it in full.
