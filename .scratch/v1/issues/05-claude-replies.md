# 05: Claude replies — free text into an idle session via the mod

**What to build:** From the session screen the owner types a reply, or taps a quick reply. If the session is idle and the source allows messages, the daemon queues it. The plugin's mod long-polls the daemon over the unix socket and submits it as the user's own turn. Busy sessions, sessions without the plugin and sources with messages off show a disabled composer with the reason.

**Blocked by:** 04

**Status:** done

- [x] plugin mod: session.start loop, `$.http.fetch` with socketPath long-poll, `$.prompt.submit({text, asUser:true})`, ack; `claude plugin validate` passes
- [x] cli: `/v1/bridge` long-poll + ack; message commands only for idle sessions; per-session "mod connected" capability reported to the relay
- [x] app: composer + quick replies + disabled reasons + delivery status
- [x] Manual check in a real tmux Claude session (like S2)

**Notes:**
- **How a reply reaches Claude:**
  - The mod (`plugins/claude-code/hooks/bridge.ts`) runs one loop per Claude process. It follows `$.session.id()`, so `/clear` and resume keep working.
  - It long-polls `GET /v1/bridge/claude?session&loop` (25 s), submits each message with `$.prompt.submit({ text, asUser: true })`, and acks with `POST /v1/bridge/claude/ack`.
  - After a plugin reload, a newer loop takes over and the old one gets a 410 and exits.
  - A session counts as replyable while its mod polls: it drops to "Replies need the AgentWatch plugin…" within about 40 s of the mod going away.
- **Delivery status:** the phone sees `applied` only after Claude took the message. Otherwise it gets a reason: busy, no plugin, refused, or not confirmed within 30 s.
- **Live check (tmux, haiku):**
  - The fake phone's "Reply with exactly the word PONG" arrived as "Prompt from the agentwatch plugin". Claude answered PONG, the command was `applied`, and the session went back to idle with replies on.
  - `claude plugin validate` passes. It lists the module's reads: `AGENTWATCH_HOME`, `HOME`, `XDG_STATE_HOME`.
- **Quick replies:** "Continue", "Yes, go ahead" and "Summarize" fill the box. Nothing is sent until Send is pressed.
- **Left for 06:** a marketplace-installed plugin (rather than `--plugin-dir`) must load its mod too. `doctor` checks that the plugin is enabled.
