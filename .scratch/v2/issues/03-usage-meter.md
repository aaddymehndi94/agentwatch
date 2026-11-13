# 03: Usage-limit meter

**What to build:** The phone shows each computer's Claude and Codex rate-limit windows (5-hour, weekly) and each
session's context fill and cost, and pushes once per window when a limit crosses 90%.

**Blocked by:** 00

**Status:** done

- [x] Claude mod reports `$.session.usage()` (after each turn, every 5 min while working) to `POST /v1/bridge/claude/usage`
- [x] Codex: `account/rateLimits/read` on attach and `account/rateLimits/updated`; context from `thread/tokenUsage/updated`
- [x] Daemon: sealed `{t: 'usage'}` per source, sent on change; context and cost in session info; 90% push (config)
- [x] Relay: migration for `sources.usage_sealed`; `SourceView.usage`
- [x] App: Settings meters, inbox line at 80%+, session header (impeccable, 390×844, both themes)
- [x] Tests: core, app model, e2e (through the relay), mod

**Decisions:**

- The inbox line names the computer only when another computer reports a different figure for the same window.
  Computers on one account report the same figures, so naming one would be noise.
- A window whose reset time has passed is dropped from the phone until the agent reports again, since its figure
  no longer holds.
