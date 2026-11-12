# 08: Offline alert, cleanup, rotate and summary privacy

**What to build:** When a source's socket has been gone ≥ 10 min (or its pings are stale) while it had active sessions, the phone gets one "offline" push. Ended sessions fade and are pruned after 3 days, and events after 7 days. `agentwatch rotate` makes a new vault key and re-pairs. Sources with `summary` privacy never send free text.

**Blocked by:** 03

**Status:** done

- [x] Hub alarm: offline detection (close event + auto-response timestamp), single push, pruning
- [x] `rotate` (new key, revoke devices, new pairing)
- [x] summary privacy enforced in the daemon before sealing (tests)

## Notes

- One Hub alarm does it all: it closes sockets whose auto-response ping is older than 90 s, sends one `offline` push per
  outage (only if that source had working/needs-you sessions and nothing is muted), prunes, and re-arms itself.
  Ended sessions and closed requests go after 3 days, events after 7, commands after 1, and expired pairings.
- E2E runs through a fake RFC 8291 push service (`test/push-service.ts`) that decrypts what the relay sends.
  `ALLOW_INSECURE_PUSH=1` (tests only) lets the relay deliver to `http://127.0.0.1`; the push library
  only signs https endpoints, so the relay signs for the https form of that local URL.
- `rotate` goes through the daemon, which holds both the relay socket and the key. The relay revokes first; only on its
  ack does the daemon save and swap the key and reconnect, so a refusal changes nothing, and re-running rotate after a
  crash finishes the job. Revoked computers now get a clear `status`/`doctor` message on 401, instead of a handshake
  that was left hanging.
- Summary privacy is enforced in core (`visibleInfo`/`visibleRequestInfo` and event text) for every adapter; tests
  cover questions, permissions, done pushes and events.
