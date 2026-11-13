# 03: Usage-limit meter

**What to build:** The phone shows each computer's Claude and Codex rate-limit windows (5-hour, weekly) and each
session's context fill and cost, and pushes once per window when a limit crosses 90%.

**Blocked by:** 00

**Status:** ready-for-agent

- [ ] Claude mod reports `$.session.usage()` (after each turn, every 5 min while working) to `POST /v1/bridge/claude/usage`
- [ ] Codex: `account/rateLimits/read` on attach and `account/rateLimits/updated`
- [ ] Daemon: sealed `{t: 'usage'}` per source, sent on change; context and cost in session info; 90% push (config)
- [ ] Relay: migration for `sources.usage_sealed`; `SourceView.usage`
- [ ] App: Settings meters, inbox line at 80%+, session header (impeccable, 390×844, both themes)
- [ ] Tests: core, relay, app model, e2e
