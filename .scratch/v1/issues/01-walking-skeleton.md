# 01: Walking skeleton — a real Claude "done" shows up in the app

**What to build:** When a Claude Code session finishes a turn, its state and last-message snippet travel through the plugin hook, the daemon (on its unix socket, started on demand), the Hub (over the outbound WebSocket) and into the app's session list. Everything is sealed with the vault key. A dev device is provisioned by the test harness; real pairing comes in 02.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] pnpm workspace with protocol / relay / app / cli and the claude-code plugin; Node 24 `.nvmrc`; biome; vitest; typecheck passes
- [ ] protocol: wire schemas (v1), session state machine for the Claude events, seal/open with associated data, ids, base64url (unit tests: round trip, tamper, wrong associated data)
- [ ] relay: `/api/claim` (CLAIM_SECRET) → source token; source WebSocket (hibernating) accepts hello/snapshot/session.upsert/event; `/api/state` for a device token; SQLite migrations
- [ ] cli: `daemon` (unix socket 0700, lock, on-demand spawn), `hook claude` (1 s budget, fail-open, no stdout), relay link with reconnect + snapshot
- [ ] Claude adapter maps SessionStart/UserPromptSubmit/Stop/SessionEnd to state + snippet, using recorded fixtures
- [ ] app: lists sessions grouped by host/user from `/api/state`, decrypting with the vault key
- [ ] E2E harness test: fixtures → daemon → relay (workerd) → fake device sees an idle session with snippet "PONG"
- [ ] With the daemon down, the hook exits 0 in < 1.2 s with no stdout
