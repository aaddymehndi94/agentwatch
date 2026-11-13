# 01: Reply to a busy agent

**What to build:** A reply from the phone to a working or waiting session is no longer refused. Claude queues it and
runs it as the next turn; Codex steers it into the running turn. The phone says which.

**Blocked by:** 00

**Status:** done

- [x] Core: `deliverMessage` drops the idle-only rule for adapters with `caps.busyReply`; they say `queued` or
  `steered`, and the applied ack's detail says which
- [x] Claude mod + bridge: the mod polls with `v=2` and acks `queued` when `submit` hasn't resolved in 1.5 s, then
  keeps polling; old mods (no `v`) keep today's idle-only behaviour
- [x] Codex: `turn/steer` with the running turn's id, `turn/start` fallback on "no active turn"; review/compact
  refusals get a clear reason
- [x] App: busy composer copy ("Queue a reply for after this turn…", "Add to Codex's current turn…"); a queued reply
  is a dashed bubble at the bottom until its prompt enters. Also fixed: a phone reply no longer shows twice (as your
  reply and as the prompt it became)
- [x] Tests: core, bridge, Codex fake server, e2e (v2 mod), mod tests (`pnpm test:plugin`), app timeline
