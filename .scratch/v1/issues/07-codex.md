# 07: Codex — status, approvals and replies via the app-server

**What to build:** The daemon attaches to the user's Codex app-server daemon. It joins running threads, maps status/turn/item events to sessions, forwards approvals and user-input requests as Requests, answers them from phone commands, and sends replies with `turn/start` to idle threads. It survives daemon restarts and updates, retries threads with no rollout yet, marks threads ended when their TUI is gone, and falls back to status-only on protocol surprises.

**Blocked by:** 04

**Status:** done

- [x] ws over the unix socket client; initialize/initialized; loaded/list + resume with backoff
- [x] mapping per spike S3; serverRequest/resolved closes Requests; decline vs accept
- [x] turn/start replies; reconnect + re-resume; TUI liveness via /proc
- [x] Fake JSON-RPC server test replaying the recorded 0.166 fixture
- [x] Manual check against a real Codex TUI in tmux (like S3)

**Notes:**
- **Live check (codex-cli 0.166.0 TUI, app-server 0.167.2, tmux, `--ask-for-approval on-request`):**
  - The approval for `printf bye > bye.txt` reached the phone with the bare command and Codex's reason. Approving from the phone ran it, and the turn ended idle with "DONE".
  - A phone reply ("Reply with exactly the word PONG") showed in the TUI as a prompt and Codex answered PONG.
  - After `/quit`, the session showed "ended" within 16 s.
- **Joining threads:** Codex replays a pending approval right after `thread/resume`, often in the same chunk as the resume response. The adapter buffers server requests that arrive while it is still joining a thread, then replays them.
- **What the phone can answer:**
  - Command and file-change approvals map to `accept` / `decline`.
  - `request_user_input` questions with options map back to question ids.
  - Free-text, secret and `permissions` requests show on the phone but are answered at the computer.
  - Other server requests (auth refresh, tool calls, elicitations) are left to the TUI.
- **Ending a session:** the app-server keeps a thread loaded while we're subscribed, so a session ends once no Codex TUI is left in its folder (`/proc`, checked twice 15 s apart), and then we `thread/unsubscribe`. Without `/proc` (macOS), sessions just stay idle.
- **Limit:** Codex sessions started with `-c` / `--enable` / `--disable` / `--search` run without the shared app-server, so they can't be seen (documented in the README). The notify-hook fallback is not built.
