# 01: Reply to a busy agent

**What to build:** A reply from the phone to a working or waiting session is no longer refused. Claude queues it and
runs it as the next turn; Codex steers it into the running turn. The phone says which.

**Blocked by:** 00

**Status:** ready-for-agent

- [ ] Core: `deliverMessage` drops the idle-only rule; adapters say `queued` or `steered`
- [ ] Claude mod + bridge: `queued` ack while busy; old mods keep today's behaviour
- [ ] Codex: `turn/steer` while active, `turn/start` fallback, clear reason for review/compact turns
- [ ] App composer copy for busy sessions; timeline shows the queued reply
- [ ] Tests: core, bridge, Codex fake server, e2e
