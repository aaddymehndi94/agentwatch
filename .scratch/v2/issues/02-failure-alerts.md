# 02: Failure alerts

**What to build:** When a turn ends on an error (usage limit, overloaded, signed out, billing, context full), the phone
gets a high-urgency push saying why, the timeline shows it and the inbox row says so until the next turn.

**Blocked by:** 00

**Status:** done

- [x] Protocol: `turn.end.failure`, transition `failed`, push kind `failed`, one wording table (`failure.ts`)
- [x] Claude `StopFailure` branch; Codex `turn/completed` with `status: failed` (built against the typed shapes; neither
  has been captured live yet)
- [x] Summary privacy: the kind only (a state, like "idle"), never `error_details`
- [x] App: "Stopped" state (inbox row, header, status sentence), timeline line with the agent's full words; service
  worker keeps unknown push kinds as sent so their seal still opens, and a `failed` push stays on screen
- [x] Tests: policy, both adapters' mappings, core push under full and summary privacy, Codex fake server, app timeline
