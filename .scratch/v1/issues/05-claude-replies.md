# 05: Claude replies — free text into an idle session via the mod

**What to build:** From the session screen the owner types a reply, or taps a quick reply. If the session is idle and the source allows messages, the daemon queues it. The plugin's mod long-polls the daemon over the unix socket and submits it as the user's own turn. Busy sessions, sessions without the plugin and sources with messages off show a disabled composer with the reason.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] plugin mod: session.start loop, `$.http.fetch` with socketPath long-poll, `$.prompt.submit({text, asUser:true})`, ack; `claude plugin validate` passes
- [ ] cli: `/v1/bridge` long-poll + ack; message commands only for idle sessions; per-session "mod connected" capability reported to the relay
- [ ] app: composer + quick replies + disabled reasons + delivery status
- [ ] Manual check in a real tmux Claude session (like S2)
