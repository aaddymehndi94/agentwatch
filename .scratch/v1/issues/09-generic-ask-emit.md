# 09: Generic adapter — `agentwatch ask` and `agentwatch emit`

**What to build:** Any script or homemade agent can ask the owner a question on the phone and get the answer on stdout: exit 0 with the answer, 2 on timeout, 3 when no daemon. It can also report a custom session's state. `docs/writing-an-adapter.md` documents this, plus the wire protocol for adding an agent.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] `ask "…" --choices a,b [--multi] [--timeout 10m]`; `emit --session … --state … --title …`
- [ ] E2E: ask → phone answer → stdout
- [ ] docs/writing-an-adapter.md + docs/protocol.md
