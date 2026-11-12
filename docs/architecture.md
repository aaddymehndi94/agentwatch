# Architecture

AgentWatch has four parts. Each one is small, and each has exactly one job.

```
Claude Code ─ plugin: command hooks ──────┐
            ◀─ plugin: mod (long-poll) ────┤  unix socket, 0600 in a 0700 folder
Codex TUI  ◀═ Codex app-server (JSON-RPC) ═┤
scripts    ─ agentwatch ask / emit ───────┘
                    agentwatchd: one per OS user, started on demand
                            ║ one outbound WebSocket (source token)
                            ▼
              Worker ─▶ Hub (Durable Object, SQLite, alarms)  ── Web Push ──▶ phone
                            ▲                                                    │
                            └────────── HTTPS (device token): state, sealed commands ◀┘
```

| Package | What it is |
| --- | --- |
| `packages/protocol` | The wire schemas (zod), crypto (AES-GCM seal/open, AAD bindings, pairing), the session state machine and the notify policy. Shared by everything else. |
| `packages/cli` | `agentwatch`: the daemon, the adapters, the hook client, and the setup, pair, join and doctor commands. Bundled by esbuild into `dist/agentwatch.mjs` and a tiny `dist/hook.mjs`. |
| `packages/relay` | The Cloudflare Worker and the Hub Durable Object. It also serves the built phone app as static assets. |
| `packages/app` | The phone PWA: Preact and Vite, with a hand-written service worker. |
| `plugins/claude-code` | The Claude Code plugin: `hooks.json`, a fail-open hook script, and the reply mod (`bridge.ts`). It is copied into the CLI bundle, so `setup` installs the matching version. |

## The daemon

**One per OS user.** Codex's app-server socket can only be reached by its own user. A single shared daemon would also
let one user inject replies into another user's agents. So each user gets their own daemon, socket and token. (Users
joined to one relay share its vault key; see Pairing below for what keeps them apart.) Nothing runs as root, and
nothing listens on the network.

- **Started on demand.** The first hook (or CLI command) that finds no socket spawns `agentwatch daemon`, detached. A
  live-socket check plus an `O_EXCL` lock file keeps it to one instance. This works without `systemd --user` or a
  login session, for example under tmux inside another user's desktop. Where there is a user systemd, setup also
  installs `agentwatch.service`, so the daemon is up at login (or boot, for a lingering user) even when only Codex
  runs, since Codex runs no hook of ours.
- **State.** The socket, lock file and log are in `~/.local/state/agentwatch/` (mode 0700), and the config is at
  `~/.config/agentwatch/config.json` (mode 0600). Sessions are saved to `sessions.json`, so a restart keeps the list.
  `AGENTWATCH_HOME` moves all of it, and the tests use that.
- **Core** (`daemon/core.ts`) is the only place that turns adapter events into state. It folds events through the
  protocol state machine and opens and closes requests. It applies the notify policy (`needs_you` after a 10 s grace,
  "done" for turns of 30 s or more) and seals everything that leaves the machine, after stripping text under
  `summary` privacy. It also verifies phone commands.
- **Relay link** (`daemon/relay.ts`): one WebSocket with backoff. Every connect sends `hello` plus a full `snapshot`, so
  the relay converges whatever it missed. Pushes and timeline events made while offline are queued for 10 minutes.

## Adapters

**Claude Code** (`adapters/claude.ts`, `adapters/claude-bridge.ts`, `plugins/claude-code`):

- **Hooks:** `SessionStart`, `UserPromptSubmit`, `Notification`, `PermissionRequest`, `PostToolUse(Failure)`,
  `PermissionDenied`, `Stop(Failure)` and `SessionEnd` each run the hook client. It connects to the socket within about
  1 s, starting the daemon if needed, and otherwise exits 0 silently.
- **Holding a request:** a `PermissionRequest` is held, for up to 11 hours, until something decides it:
  - a phone decision, answered with `decision.behavior` allow or deny;
  - an `AskUserQuestion` answer, answered with `updatedInput.answers`;
  - an answer at the keyboard, recognised by the matching `PostToolUse`.

  The terminal dialog stays live meanwhile. Whichever side answers first wins, and the other side is told.
- **Replies:** the plugin's mod long-polls the daemon (`GET /v1/bridge/claude`) and submits each reply with
  `$.prompt.submit({ asUser: true })`. Then it acks. A session whose mod isn't polling can't take replies, and the app
  says why.

**Codex** (`adapters/codex.ts`): a JSON-RPC client over WebSocket on the user's own
`~/.codex/app-server-control/app-server-control.sock`.

- **Connecting:** `initialize`, then it polls `thread/loaded/list` and calls `thread/resume` on each live thread.
- **Requests:** approval requests (`item/commandExecution|fileChange/requestApproval`) and `item/tool/requestUserInput`
  become requests. `serverRequest/resolved` closes them when the TUI answers first.
- **Replies:** they go in with `turn/start`.
- **Ended threads:** a thread whose TUI process is gone is marked ended. Unknown methods are ignored.

**Generic** (`adapters/generic.ts`): `agentwatch ask` and `agentwatch emit`, for scripts. See
[writing-an-adapter.md](writing-an-adapter.md).

## The relay

There's one Worker, which routes `/api/*` to a single Durable Object, the **Hub**, and serves the app for everything
else.

- **Storage:** the Hub keeps SQLite tables for tokens (SHA-256 hashed), sources, sessions, requests, events, devices,
  push subscriptions, pairings and commands. Everything a human wrote is stored sealed.
- **Sources:** they hold hibernatable WebSockets. The `ping` keepalive is answered by the runtime's auto-response, so
  an idle relay sleeps.
- **Phones:** they poll `GET /api/state` every 10 s while the app is visible, and post sealed commands. The Hub hands
  a command to the source's socket, or queues it for 5 minutes if the source is offline.
- **One alarm:** it closes sockets that stopped pinging (90 s), and sends one "offline" push per outage. It also
  prunes:
  - ended sessions and closed requests after 3 days;
  - events after 7 days;
  - commands after 1 day.
- **Web Push:** the Hub sends it with VAPID keys it generates for itself, encrypting per RFC 8291.

## The phone app

- **Storage:** the vault key and device token live in IndexedDB, where the service worker can read them to decrypt a
  push before showing it. The last state is cached, so the app opens offline and says how old it is.
- **Pairing:** pairing reads a one-time code from the link's `#fragment`. On iPhone, the app asks to be added to the
  Home Screen first, because that is the only place iOS delivers push, and it has its own storage.
- **Design:** `DESIGN.md`. Requests hang on a rail with aging timers; sessions are quiet rows grouped by `user@host`.

## Flows

**Approval from the phone:**

1. Claude asks to run a command. The hook connects and Core opens a request.
2. The request is sealed and sent to the relay, and after 10 s a high-urgency push goes out.
3. On the phone, Approve posts a command sealed with the vault key and bound to this source, session, request, time
   and a nonce. The Hub forwards it.
4. Core verifies it: seal, binding, ±5 min, after the daemon started, fresh nonce, still open. Then it releases the
   held hook with `allow`.
5. The ack flows back, and the ticket reads "Approved".

**Reply:** this follows the same path with a `message` command. Core checks that messages are allowed and the session
is idle, then hands the text to the adapter (the Claude mod, or Codex `turn/start`). The text arrives as the next
prompt.

**Pairing:**

1. `agentwatch pair` makes a random `pairId` and secret, and uploads the vault key wrapped under an HKDF of the secret.
2. The link carries `#/pair/<pairId>.<secret>`.
3. The phone claims the `pairId` once, gets a device token and the wrapped key, and unwraps it locally.

`invite` and `join` do the same for another source. Only the **owner** (the source that claimed the relay) can create
pairings or rotate the key. Every source holds the vault key, so this keeps a joined OS user from pairing a phone of
its own and using it to read or steer the others.

## Testing

- **Unit tests** cover the protocol (crypto, tampering, replays, the state machine, the policy), Core and each
  adapter. They run against recorded payloads, and Codex runs against a fake JSON-RPC server.
- **The E2E harness** (`packages/cli/test/e2e.test.ts`) runs the real relay in workerd and the real CLI in a temporary
  home. Recorded Claude hook payloads go through the real hook client. A fake phone pairs, decrypts and answers. A
  fake Web Push service decrypts what the relay sends.
- **App screenshots** at 390×844, in light and dark: `pnpm --filter @agentwatch/app screenshots`.
