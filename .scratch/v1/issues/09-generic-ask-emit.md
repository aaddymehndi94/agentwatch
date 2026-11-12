# 09: Generic adapter — `agentwatch ask` and `agentwatch emit`

**What to build:** Any script or homemade agent can ask the owner a question on the phone and get the answer on stdout: exit 0 with the answer, 2 on timeout, 3 when no daemon. It can also report a custom session's state. `docs/writing-an-adapter.md` documents this, plus the wire protocol for adding an agent.

**Blocked by:** 04

**Status:** done

- [x] `ask "…" --choices a,b [--multi] [--timeout 10m]`; `emit --session … --state … --title …`
- [x] E2E: ask → phone answer → stdout
- [x] docs/writing-an-adapter.md + docs/protocol.md

## Notes

- `GenericAdapter` (`src/adapters/generic.ts`) keeps caller session names apart from Claude/Codex ids with a `g:` prefix.
  An `ask` without `--session` gets a one-off session that ends once it is answered.
- `ask --approve` is a permission request: one-tap Approve/Deny on Android, exit 0/1, so `ask --approve … && deploy` works.
- Under summary privacy `ask` refuses (exit 1), rather than sending a question the phone can't show.
- `emit --pid` ends the session when that process exits. Sessions silent for 24 h are ended.
- Found while testing: on a cold start the first timeline event raced the relay connection and was dropped. The relay
  link now queues events offline, like pushes, and the Hub orders events with the same timestamp by insertion.
- Docs: `docs/writing-an-adapter.md` (shell, socket API, built-in adapters) and `docs/protocol.md` (wire, crypto, pairing).
