# Spike results (2026-11-12)

The spikes were run against real agents in detached tmux sessions on this machine (as a user running in tmux under another user's desktop session).
The throwaway code is in `spikes/` (gitignored). The fixtures were copied into `packages/cli/test/fixtures/`.

## S1 — Claude permission hold: PASS (this changes the plan: away mode is no longer needed)

Claude Code 2.1.322, `--permission-mode default`, a plugin `PermissionRequest` command hook that sleeps.

- While the hook is held, **the terminal dialog is shown and stays answerable**, and a local answer wins at once (the tool runs and `PostToolUse` fires).
- **The held hook is NOT killed** when the user answers locally (it got no signal and ran to its own end), so the daemon must release it on local resolution.
- A hook that returns `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
  while the dialog is open closes the dialog and the tool runs ("Allowed by PermissionRequest hook").
- **`PermissionRequest` also fires for `AskUserQuestion`** (after `PreToolUse`). Returning
  `decision.behavior:"allow"` plus `updatedInput: {...tool_input, answers: {"<question>": "<label>"}}` answers it
  ("User answered Claude's questions: Ship it? → No"). While that hook is held, the question dialog is also shown
  locally and stays answerable.
- `PermissionRequest` has **no `tool_use_id`**. Correlate it with the following `PostToolUse` (`tool_name` + `tool_input`, same `prompt_id`).
- `Notification` (`permission_prompt`) fires about 6 s after the dialog opens, so dedupe it against `PermissionRequest`.
- `Stop` carries `last_assistant_message`. `SessionEnd.reason` is e.g. `prompt_input_exit`, and fires on tmux kill too.
- The default permission mode on this machine is **auto** (a classifier answers most prompts), so the `needs_you` volume will be low.

⇒ **Design: always hold `PermissionRequest` (including AskUserQuestion) when a device is paired and the relay is
connected.** Release it on: a phone decision, a local resolution (`PostToolUse` for the same tool+input, `Stop`,
`UserPromptSubmit`, `SessionEnd`), the hook timeout, or a daemon restart. Away mode is dropped from v1.

## S2 — Claude mod reply: PASS

- A plugin's `hooks/hooks.json` can carry both `"hooks"` (command hooks) and `"modules"` (a mod), and loads with `--plugin-dir`.
- `$.http.fetch(url, { socketPath })` reaches a **unix socket**: the mod long-polls the daemon directly, with no extra
  process and no TCP port.
- `$.prompt.submit({ text, asUser: true })` from a background loop started in `session.start` starts a new turn in an
  idle session. The transcript shows "Prompt from the awspike plugin" above the text. `UserPromptSubmit` and `Stop`
  hooks fire normally.
- `$.session.id()` gives the session id inside the mod.

## S3 — Codex app-server attach: PASS, with caveats

codex-cli 0.166.0 TUI in tmux; the shared daemon ran with a `pid` backend (no systemd needed).

- **`-c` / `--enable` / `--disable` / `--search` force embedded mode** ("Running without the shared background
  server"). Those sessions can't be attached to, so they're notify-only. `-m`, `--ask-for-approval` and `--sandbox` are fine.
- Client: `ws` with the URL `ws+unix:<realpath of ~/.codex/app-server-control/app-server-control.sock>:/`, then
  `initialize {clientInfo, capabilities:{experimentalApi:true}}`, then the `initialized` notification.
- `thread/loaded/list` → `thread/resume {threadId}`. Before a thread's first message there is no rollout ("no rollout
  found"), so retry with backoff. Ephemeral helper threads never get one, so give up on those after N tries.
- **Pending approvals are replayed** to a client that resumes later (`item/commandExecution/requestApproval`,
  JSON-RPC id 0 on our connection).
- Answering `{id, result:{decision:"accept"}}` → `serverRequest/resolved` → the TUI prompt closes and the command runs.
- `turn/start {threadId, input:[{type:"text", text, text_elements:[]}]}` from our client shows in the TUI as a user
  prompt, and Codex answers it.
- Signals: `thread/status/changed` (`active{activeFlags:[waitingOnApproval]}` / `idle`), `turn/started`,
  `turn/completed`, `item/completed` with `item.type:"agentMessage", phase:"final_answer"` (the last message),
  `thread/name/updated` (a title).
- **The daemon auto-updated 0.166.0 → 0.167.2 and restarted mid-spike** (the WS closed with 1006), so the adapter needs
  reconnect with backoff and must re-join its threads.
- No `thread/closed` arrived after the TUI exited while we were subscribed. For v1, "ended" is detected by TUI process
  liveness (`/proc`: a codex TUI process with that cwd), then we `thread/unsubscribe`.
- That user's Codex daemon also reports `remoteControl/status/changed: connected` (OpenAI's own phone relay). It coexists with us.

## S4 — Push: deferred into the relay ticket (unit test against a reference RFC 8291 decrypt; real phone in the morning).

## S5 — logind: the tmux user can read seat0's `LockedHint`/`IdleHint`. No longer needed, since away mode was dropped.
