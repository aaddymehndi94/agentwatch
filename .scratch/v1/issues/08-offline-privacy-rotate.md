# 08: Offline alert, cleanup, rotate and summary privacy

**What to build:** When a source's socket has been gone ≥ 10 min (or its pings are stale) while it had active sessions, the phone gets one "offline" push. Ended sessions fade and are pruned after 3 days, and events after 7 days. `agentwatch rotate` makes a new vault key and re-pairs. Sources with `summary` privacy never send free text.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Hub alarm: offline detection (close event + auto-response timestamp), single push, pruning
- [ ] `rotate` (new key, revoke devices, new pairing)
- [ ] summary privacy enforced in the daemon before sealing (tests)
