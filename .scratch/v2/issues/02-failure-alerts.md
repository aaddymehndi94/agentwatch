# 02: Failure alerts

**What to build:** When a turn ends on an error (usage limit, overloaded, signed out, billing, context full), the phone
gets a high-urgency push saying why, the timeline shows it and the inbox row says so until the next turn.

**Blocked by:** 00

**Status:** ready-for-agent

- [ ] Protocol: `turn.end.failure`, transition `failed`, push kind `failed`, one wording table for both agents
- [ ] Claude `StopFailure` branch; Codex `turn/completed` with `status: failed`
- [ ] Summary privacy: plain wording only, never `error_details`
- [ ] App: timeline line, inbox row, service-worker copy
- [ ] Tests: policy, adapters with fixtures, e2e push
