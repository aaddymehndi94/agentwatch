Status: ready-for-agent

# AgentWatch v1 — spec

## Problem Statement

I run many Claude Code and Codex sessions at once, across several OS users on a laptop, often in tmux under another
user's desktop session. When one needs me (a permission prompt or a question) or finishes, the most I get is a sound on
the laptop. When I'm out, or the agents run overnight, they sit blocked for hours and I have no idea what is running.
The developers I work with have the same problem with their own agents, and with agents they build themselves. Hosted
tools either cost money, need their own apps, cover only one agent, or can read my prompts.

## Solution

AgentWatch is a pager for coding agents, made of three parts:
- **A daemon on each OS user.** It watches Claude Code (through a plugin's hooks and mod) and Codex (as an extra
  client of its shared app-server). It keeps one outbound WebSocket to the owner's own **relay**: a free Cloudflare
  Worker with a single Durable Object.
- **The relay.** It serves an installable phone **app** (PWA) and sends Web Push.
- **The phone app.** It shows every session across hosts and users, and gets a push when an agent needs you or
  finished a long turn. From there you approve or deny, answer the agent's question, or type a short reply that
  arrives in the session as if typed at the keyboard.

The laptop terminal keeps working normally the whole time, and whichever answer comes first wins. Everything readable
(prompts, commands, messages, project names) is sealed with the owner's vault key, so Cloudflare only sees
ciphertext and coarse states. Any developer can deploy their own copy with one command and pair a phone by scanning a
QR code.

## User Stories

### Notifications and the overview
1. As an owner, I want a push on my phone when any agent asks for permission, so that it doesn't sit blocked while I'm out.
2. As an owner, I want a push when any agent asks me a multiple-choice question, so that I can answer it from wherever I am.
3. As an owner, I want a push when an agent finishes a turn that took at least 30 seconds, so that I know long work is done without being spammed by quick replies.
4. As an owner, I want no push for sessions starting or ending, so that my phone stays quiet.
5. As an owner, I want the push to show the project and a short snippet of the message, so that I can decide whether it matters without opening the app.
6. As an owner, I want pushes from my work user to say only "Claude finished in <project>", never message text, so that work content never leaves the machine.
7. As an owner, I want to open the app and see every running session across all my OS users and machines, grouped by host and user, so that I know what is running.
8. As an owner, I want each session to show its agent, project, state (working / needs you / idle / ended), how long it has been in that state, and the last message snippet, so that I can scan them in seconds.
9. As an owner, I want sessions that need me pinned at the top, so that the urgent thing is the first thing I see.
10. As an owner, I want ended sessions to fade out and disappear after a while, so that the list stays about now.
11. As an owner, I want to see whether each laptop/user is online and when it was last seen, so that I can trust what I'm looking at.
12. As an owner, I want one "laptop offline" push when a source disappears while agents were active, so that I know the list is stale.
13. As an owner, I want to mute pushes for 1 hour or until 8 a.m., so that I can sleep or focus.
14. As an owner, I want the app to open instantly with the last known state even with poor signal, so that a glance is always possible.
15. As an owner, I want the session view to show a short timeline of recent events (prompted, asked, approved, finished), so that I understand what happened while I was away.

### Answering
16. As an owner, I want to approve or deny a permission request from the app, with the exact command or file shown, so that I can unblock an agent safely.
17. As an Android owner, I want Approve and Deny buttons on the notification itself, so that I don't have to open the app.
18. As an iPhone owner, I want tapping the notification to open straight to that request, so that answering takes one more tap.
19. As an owner, I want to answer an agent's question by tapping an option (or several, for multi-select), so that the agent continues with my choice.
20. As an owner, I want the terminal prompt on the laptop to keep working while the phone also shows it, so that whoever is nearest can answer.
21. As an owner, I want a request I already answered at the laptop to disappear from the phone (or show "answered at laptop"), so that I never act on a stale prompt.
22. As an owner, I want to see whether my answer was delivered, applied or expired, so that I know the agent actually got it.
23. As an owner, I want to send a free-text reply to an idle session, so that I can tell it to continue, adjust, or try something else.
24. As an owner, I want quick replies such as "continue" and "yes, go ahead", so that I can reply with one tap.
25. As an owner, I want the reply box disabled, with the reason shown, when a session can't take a reply (busy, Codex in embedded mode, replies turned off for that source), so that I'm never confused about why nothing happened.
26. As an owner, I want free-text replies allowed per source and on by default, so that I can turn them off for a sensitive user.

### Pairing and setup
27. As a developer, I want to deploy my own relay to my free Cloudflare account with one command, so that I pay nothing and own my data.
28. As a developer, I want `agentwatch setup` to wire up Claude Code and Codex for my OS user without breaking my existing settings, so that I don't hand-edit JSON.
29. As a developer, I want `agentwatch pair` to show a QR code and a link, so that I can pair my phone in under a minute.
30. As an iPhone user, I want the app to tell me to Add to Home Screen first, and then let me paste the pairing link inside the installed app, so that pairing works with iOS storage rules.
31. As an owner, I want to add my other OS users and machines to the same relay with `agentwatch invite` and `agentwatch join`, so that one phone sees everything.
32. As an owner, I want to pair more than one device, see the list, and revoke one, so that a lost phone can be cut off.
33. As an owner, I want `agentwatch rotate` to make a new vault key, so that I can recover from a stolen phone.
34. As a developer, I want `agentwatch doctor` to check every link (daemon, Claude plugin, Codex daemon, relay, push) and say exactly what to fix, so that I can debug without reading code.
35. As a developer, I want `agentwatch doctor --test-push` to send a test push, so that I can confirm notifications end to end.
36. As a developer, I want `agentwatch status` to list what the daemon sees right now, so that I can compare it with the phone.
37. As a developer, I want the daemon to start itself the first time an agent fires a hook, so that it works even where no systemd user manager exists (e.g. tmux under another user's desktop).
38. As a developer on a normal desktop, I want an optional systemd user unit (or launchd plist on macOS), so that the daemon is always up.

### Safety and robustness
39. As an owner, I want agents and terminals to behave exactly as without AgentWatch whenever the daemon or relay is down, so that it never costs me work.
40. As an owner, I want hooks to finish within about a second when nothing is listening, so that my agents never feel slower.
41. As an owner, I want Cloudflare to be unable to read my prompts or forge an approval, so that hosting it is safe.
42. As an owner, I want a command older than 5 minutes, replayed, or aimed at a request that is no longer open to be rejected, so that nothing stale or duplicated runs.
43. As an owner, I want the daemon to recover by itself from Codex daemon restarts/updates, relay deploys and network drops, so that I never babysit it.
44. As an owner, I want Codex sessions started with `-c` overrides (which run embedded) to still show up and notify, clearly labelled "notify-only", so that I know why I can't reply.
45. As an owner, I want sessions that started before I installed AgentWatch to still appear (status only), so that the overview is complete from day one.

### Generic and extensible
46. As a developer building my own agent, I want `agentwatch ask "Deploy?" --choices yes,no` to push to my phone and print my answer, so that any script can ask a human.
47. As a developer, I want `agentwatch emit` to report a custom session's state, so that my own agents appear in the overview.
48. As a contributor, I want a documented adapter interface and wire protocol, so that I can add support for another agent.
49. As a developer, I want the whole thing free, open source (MIT) and free of secrets in the repo, so that I can fork it and give it to my team.

## Implementation Decisions

**Modules** (pnpm workspace):
- **protocol** (pure, runs in Node, Workers and browsers):
  - Wire schemas with a protocol version `v: 1`.
  - The session state machine `reduce(session, adapterEvent) → session'`.
  - The notify policy `decide(prev, next, ctx) → Push | null`.
  - Crypto (WebCrypto only): vault key, `seal/open` with associated data, pairing wrap/unwrap, base64url, random ids.
  - The command envelope build/verify.
- **relay:**
  - **Worker:** Hono routes forward every `/api/*` call to the Hub. Static assets come from the app build; the SPA
    uses hash routing.
  - **Hub DO, SQLite tables:** `meta`/`migrations`, `sources`, `sessions`, `requests`, `events`, `devices`,
    `push_subscriptions`, `pairings`, `commands`.
  - **Hub WebSockets:** accepts sources' WebSockets with hibernation and `setWebSocketAutoResponse` ping/pong.
  - **Hub VAPID:** generates the VAPID keypair on first use.
  - **Hub push:** sends Web Push with `@block65/webcrypto-web-push` and prunes 404/410 subscriptions.
  - **Hub alarm:** handles offline detection and pruning (events after 7 days, ended sessions after 3 days).
- **app:**
  - Preact + Vite PWA with a hand-written service worker.
  - Screens: Inbox, Session, Pair, Settings.
  - IndexedDB holds the vault key, device token and last state.
  - Push and notification actions are handled in the service worker.
- **cli** (Node ≥ 22, bundled into one `.mjs`):
  - Commands: `setup`, `relay deploy`, `pair`, `invite`, `join`, `status`, `doctor`, `rotate`, `mute`, `ask`, `emit`,
    `uninstall`.
  - Internal commands: `daemon`, `hook <agent>`, `dev simulate`.
- **plugins/claude-code:** a Claude Code plugin made of `hooks/hooks.json` (command hooks) and a mod module.
  `bin/hook.sh` resolves the launcher and fails open.

**The daemon's local API** (HTTP over a unix socket at `~/.local/state/agentwatch/agentwatchd.sock`, directory 0700):
- `POST /v1/hook/claude` takes a raw hook payload. For `PermissionRequest` it holds the response, and the body is the
  hook's stdout JSON or empty.
- `GET /v1/bridge?session=<id>` is a 25 s long-poll that returns queued replies for the mod.
- `POST /v1/ask` / `POST /v1/emit` serve the generic adapter.
- `GET /v1/status` reports what the daemon sees.

Starting on demand:
- The hook connects with a 1 s budget. On `ENOENT`/`ECONNREFUSED` it spawns `agentwatch daemon --detach` and gives up
  on this event (except `SessionStart`, which retries once after 300 ms).
- A single-instance lock file guards startup: `O_EXCL` lock plus stale-pid check, then unlink + listen.

**Claude adapter.** These decisions come from spike S1/S2:
- **Hook timeouts:** `PermissionRequest` hooks run with a long `timeout`, around 12 h (to be verified). Other hooks get 5 s.
- **Holding a request:** on `PermissionRequest`, open a Request (`permission`, or `question` when
  `tool_name == "AskUserQuestion"`) and hold the hook's connection.
- **Releasing a held hook:**
  - **phone decision:** write `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"|"deny","message"?}}}`.
    For questions, write `decision.behavior:"allow"` with `updatedInput: {...tool_input, answers}`.
  - **local resolution, timeout or session end:** empty body, closing the Request as `answered_locally`/`expired`.
    Local resolution means a `PostToolUse` with the same `tool_name`+`tool_input`, or any `Stop`, `UserPromptSubmit`
    or `SessionEnd` for the session.
- **Deduplication:** `Notification(permission_prompt)` is deduped against an open Request, and
  `Notification(idle_prompt)` is ignored.
- **State mapping:**
  - `SessionStart` → idle (with a title from `session_title` when present)
  - `UserPromptSubmit` → working (turn starts)
  - `PermissionRequest` → needs_you
  - `PostToolUse` after a release → working
  - `Stop` → idle (turn ends; `last_assistant_message` becomes the snippet)
  - `SessionEnd` → ended
- **Polling:** every 30 s the adapter polls `claude agents --json` for liveness and to discover sessions that started
  before setup (status only).
- **Mod:**
  - In `session.start` it starts a background loop that long-polls `/v1/bridge` with `$.http.fetch(…, { socketPath })`.
  - It calls `$.prompt.submit({ text, asUser: true })` for each message.
  - It acks delivery with `POST /v1/bridge/ack`.
  - The daemon only queues messages for idle sessions.

**Codex adapter.** These decisions come from spike S3:
- **Connection:** a `ws` client to `ws+unix:<realpath(~/.codex/app-server-control/app-server-control.sock)>:/`, then
  `initialize` with `experimentalApi`, then `initialized`.
- **Joining threads:** poll `thread/loaded/list` every 3 s, then `thread/resume`. Retry "no rollout" with backoff and
  give up after 10 tries.
- **Mapping:**
  - `thread/status/changed`: `active` with `waitingOnApproval`/`waitingOnUserInput` → needs_you; `active` → working; `idle` → idle.
  - `turn/started` and `turn/completed` mark turn boundaries.
  - `item/completed` with `agentMessage` and `final_answer` gives the snippet.
  - `thread/name/updated` gives the title.
- **Requests:** `item/commandExecution/requestApproval`, `item/fileChange/requestApproval` and
  `item/tool/requestUserInput` open Requests. `serverRequest/resolved` closes them as answered elsewhere. Phone
  decisions reply `{decision:"accept"|"decline"}` or `{answers}`.
- **Messages:** `turn/start` with a text input, or `turn/steer` when a turn is active and the source allows it. v1
  sends to idle threads only.
- **Lifecycle:**
  - Reconnect with backoff, then re-resume the joined threads; pending approvals are replayed.
  - A thread whose cwd has no live Codex TUI process for 30 s is unsubscribed and marked ended.
  - Unknown methods and shapes are logged and ignored.
  - A version mismatch drops the adapter to status-only.
- **Fallback:** sessions launched in embedded mode don't appear in the daemon. Setup offers the `notify` program hook
  (turn complete → done push, notify-only).

**Generic adapter:**
- `ask` opens a `question` Request on a synthetic session and blocks on the daemon. It prints the chosen label(s) and
  exits 0, or exits 2 on timeout and 3 if no daemon.
- `emit` upserts a synthetic session's state and snippet.

**Daemon ↔ Relay** (one WebSocket to `wss://<relay>/api/source/ws`, bearer source token, JSON messages with `v:1`):
- **Up:**
  - `hello {sourceId, host, user, privacy, allowMessages, adapters, daemonVersion}`
  - `snapshot {sessions, requests}`, sent after every (re)connect; the relay expires Requests the snapshot omits
  - `session.upsert {session}`
  - `event {sessionId, kind, at}`
  - `request.open {request}`
  - `request.close {requestId, resolution}`
  - `push {tag, urgency, sessionId, requestId?, sealed}`
  - `command.ack {commandId, status, detail?}`
  - `pair.create`, `invite.create`
- **Down:** `command {commandId, envelope}`, `settings {mute}`.

**Data on the wire.** Clear fields are random/agent ids, agent kind, state, timestamps and request kind. Everything
else is in a sealed blob: titles, cwd/project, snippets, tool details, questions, replies.

**Phone ↔ Relay** (HTTPS, bearer device token):
- `GET /api/state`
- `GET /api/sessions/:id/events`
- `POST /api/commands` → `{commandId}`; `GET /api/commands/:id` returns the status
- `POST|DELETE /api/push/subscription`
- `POST /api/push/test`
- `GET /api/vapid`
- `POST /api/mute`
- `GET /api/devices`, `DELETE /api/devices/:id`
- `POST /api/pair/claim` (no token; one-time pair id)

**Owner bootstrap:**
- `POST /api/claim` with the deploy-time `CLAIM_SECRET` returns the first source token. It works once.
- `POST /api/join/claim` (one-time join id) returns a source token.

**Crypto:**
- **Seal:** AES-256-GCM with a 12-byte random IV. Associated data is the canonical JSON of the binding fields
  (`v, kind, sourceId, sessionId, requestId?, commandId?, deviceId?, ts?, nonce?`).
- **Pairing:**
  - The wrap key is `HKDF-SHA256(pairSecret, info="agentwatch/pair/v1")`, and the vault key is sealed under it with
    the pair id as associated data.
  - The link is `https://<relay>/#/pair/<pairId>.<secret>`. The relay deletes the pairing on first claim or after 10 min.
- **Commands:** the envelope `{commandId, deviceId, sourceId, sessionId, requestId?, kind, ts, nonce}` is sent in the
  clear, with the body sealed under that envelope as associated data. Before acting, the daemon requires:
  - the seal opens;
  - `ts` is within ±5 min and after daemon start;
  - the nonce is unused;
  - the Request is open, for decide/answer;
  - `allowMessages` is on and the session is idle, for messages.

**Config** (`~/.config/agentwatch/config.json`, 0600): relay URL, source id and token, vault key, privacy,
allowMessages, `notify.doneMinSeconds` (30), and adapter enables.

**Setup:**
- Copies the bundle to `~/.local/share/agentwatch/<version>/` and writes the launcher `~/.local/bin/agentwatch` with
  the absolute Node path.
- Installs the Claude plugin from a local marketplace directory at user scope.
- Backs up any file it edits.
- Is idempotent.

**Push payload:** `{v, tag, kind, sourceId, sessionId, requestId?, sealed}` (≤ ~1.5 KB). The service worker decrypts
it and always shows a notification, falling back to generic text. Android gets Approve/Deny actions for permissions.

## Testing Decisions

- **Good tests exercise external behaviour at the highest seam:** what an agent sees (hook stdout, JSON-RPC
  replies), what the phone sees (`/api/state`, pushes) and what a command does. They never touch internals.
- **Primary seam, the end-to-end harness (in-process):**
  - real daemon core;
  - relay in workerd/miniflare via `wrangler dev` or the vitest pool;
  - a fake device client that pairs, reads state and sends sealed commands;
  - recorded real Claude hook payloads fed into the daemon's unix socket;
  - a fake Codex app-server JSON-RPC server replaying recorded messages.

  This one seam covers the walking skeleton and most stories.
- **Secondary seam: protocol pure functions.** Covers the state machine, notify policy, and crypto (round trip,
  tamper, wrong associated data, replay, stale ts).
- **Relay unit tests** with `@cloudflare/vitest-pool-workers`: auth (401s, a device can't act as a source),
  snapshot expiry, push sending (a fetch mock that decrypts the payload as a reference receiver), alarms.
- **App:** Playwright at 390×844 against `wrangler dev` with `dev simulate`, covering the inbox, the approve flow and
  pairing. Screenshots in light and dark.
- **Fixtures** come from spikes S1–S3: `claude-2.1.322-session.json` and `codex-0.166.0-attach-approve-turnstart.jsonl`.
- **Prior art:** none in this repo yet. These tests set the pattern.

## Out of Scope

- Transcripts or streaming agent output.
- Starting new sessions from the phone.
- A shared multi-tenant team relay.
- A native app.
- Windows. macOS gets an untested launchd plist only.
- Claude Code channels.
- Steering a busy Codex turn.
- An npm publish (can happen later).

## Further Notes

- **Away mode was dropped** after S1 proved the Claude terminal dialog stays live while a hook is held.
- **The auto-updating Codex daemon** (0.166 → 0.167.2 during the spike) makes version tolerance a must.
- **Default permission mode on the owner's machine is `auto`,** so `needs_you` will be rarer than in manual mode.
- **SECURITY.md must state the honest limit:** whoever controls the owner's Cloudflare account can serve modified
  app JS that reads the vault key.
