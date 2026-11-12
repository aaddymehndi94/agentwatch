# 07: Codex — status, approvals and replies via the app-server

**What to build:** The daemon attaches to the user's Codex app-server daemon. It joins running threads, maps status/turn/item events to sessions, forwards approvals and user-input requests as Requests, answers them from phone commands, and sends replies with `turn/start` to idle threads. It survives daemon restarts and updates, retries threads with no rollout yet, marks threads ended when their TUI is gone, and falls back to status-only on protocol surprises.

**Blocked by:** 04

**Status:** ready-for-agent

- [ ] ws over the unix socket client; initialize/initialized; loaded/list + resume with backoff
- [ ] mapping per spike S3; serverRequest/resolved closes Requests; decline vs accept
- [ ] turn/start replies; reconnect + re-resume; TUI liveness via /proc
- [ ] Fake JSON-RPC server test replaying the recorded 0.166 fixture
- [ ] Manual check against a real Codex TUI in tmux (like S3)
