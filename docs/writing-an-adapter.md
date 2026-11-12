# Bring your own agent

AgentWatch ships adapters for Claude Code and Codex. Anything else (a deploy script, a nightly job, an agent you wrote)
can use the same phone, in three ways. Start with the first and only go further if you need to.

| Way | Effort | What you get |
| --- | --- | --- |
| [`agentwatch ask` / `emit`](#1-from-a-shell-script) | one line of shell | questions, approvals, a session in the app, "done" pushes |
| [The local daemon API](#2-from-any-language-the-local-daemon-api) | an HTTP call over a unix socket | the same, from any language without spawning a process |
| [A built-in adapter](#3-a-built-in-adapter) | TypeScript, in this repo | everything Claude and Codex get, including replies into the agent |

Whichever way you choose, the daemon seals text with your key before anything leaves the computer, and it follows this
OS user's privacy setting. You never handle keys or the relay yourself.

## 1. From a shell script

```sh
# A question: prints the chosen label. Defaults to Yes / No.
env=$(agentwatch ask "Deploy which build?" --choices "staging,production" --timeout 15m) || exit

# An approval: Approve / Deny, one tap from the notification on Android.
agentwatch ask --approve "Run the migration on prod?" --detail "$(cat plan.sql)" && ./migrate.sh

# Show a long job in the app; the phone buzzes when it goes idle after 30 s or more of work.
agentwatch emit --session nightly-etl --state working --message "Step 2 of 4" --pid $$
agentwatch emit --session nightly-etl --state idle --message "Loaded 1.2M rows"
agentwatch emit --session nightly-etl --state ended
```

**`agentwatch ask "<question>"`**

| Option | Meaning |
| --- | --- |
| `--choices a,b,c` | The options (up to 20). Default: `Yes,No`. |
| `--multi` | Allow several. Each chosen label is printed on its own line. |
| `--approve` | An Approve / Deny request instead of a question. Prints `approved` or `denied`. |
| `--detail <text>` | Longer context shown under the question (a command, a diff, a plan). |
| `--timeout <d>` | How long to wait: `90s`, `10m`, `2h`. Default `10m`, longest `24h`. |
| `--session <name>` | Ask inside a session you report with `emit`. Otherwise the question gets a one-off session that ends when it is answered. |
| `--title <text>` | The session's title in the app. |
| `--json` | Print the result as JSON: `{"status":"answered","answers":["staging"]}`. |

| Exit code | Meaning |
| --- | --- |
| 0 | Answered (labels on stdout), or approved |
| 1 | Denied (`--approve`), or the daemon refused (the reason is on stderr) |
| 2 | No answer in time, or the question was cancelled |
| 3 | AgentWatch isn't set up for this OS user, or its daemon can't start |
| 64 | Bad arguments |

`Ctrl-C` cancels the question on the phone too. Under `summary` privacy `ask` refuses (exit 1), because the phone
would only be able to show an empty question.

**`agentwatch emit --session <name>`**

| Option | Meaning |
| --- | --- |
| `--state working\|idle\|ended` | `working` starts a turn, `idle` ends it (a turn of 30 s or more pushes "done"), and `ended` closes the session. |
| `--message <text>` | A status line. Going `idle`, it becomes the "done" notification's text. |
| `--title`, `--project` | How the session is named in the app. The project defaults to the current folder's name. |
| `--pid <pid>` | End the session when that process exits (`--pid $$` for the calling shell). |

Session names are yours: letters, digits and `. : @ _ -`, up to 100. A session with no `emit` for 24 hours is ended,
so a script that dies without saying so doesn't stay "working" forever. The phone can't send replies to these sessions.

## 2. From any language: the local daemon API

`ask` and `emit` are thin clients of the daemon's HTTP API on a unix socket:
`~/.local/state/agentwatch/agentwatchd.sock`, or `$AGENTWATCH_HOME/state/agentwatchd.sock` when that variable is set.
The socket is `0600` inside a `0700` folder, so only this OS user can use it. If nothing is listening, run
`agentwatch daemon` (or any `agentwatch` command that needs it), or treat AgentWatch as absent.

```sh
S=~/.local/state/agentwatch/agentwatchd.sock
curl -s --unix-socket $S http://d/v1/emit -H 'content-type: application/json' \
  -d '{"session":"nightly-etl","state":"working","message":"Step 2 of 4","cwd":"'"$PWD"'"}'
curl -s --unix-socket $S http://d/v1/ask -H 'content-type: application/json' -m 700 \
  -d '{"question":"Ship it?","choices":["Ship","Wait"],"timeoutMs":600000}'
# → {"status":"answered","answers":["Ship"]}
```

| Endpoint | Body | Answer |
| --- | --- | --- |
| `POST /v1/emit` | `session`, and optionally `state`, `title`, `project`, `cwd`, `message`, `pid` | `{session, state}` |
| `POST /v1/ask` | `question`, `timeoutMs`, and optionally `choices[]`, `multi`, `approve`, `detail`, `session`, `title`, `cwd` | `{status: "answered", answers[]}`, `{status: "approved"}`, `{status: "denied", message?}`, `{status: "expired" \| "cancelled"}` |
| `GET /v1/status` | none | what the daemon sees: relay link, adapters, sessions, open requests |

`/v1/ask` holds the HTTP request open until the answer arrives, so set your client's timeout above `timeoutMs`. Closing
the connection cancels the question. Bad input gets a `400` with an `error`, and `ask` under summary privacy gets a `403`.

## 3. A built-in adapter

When an agent has hooks or an API of its own, a built-in adapter gets the full experience: live state, approvals and
answers routed back into the agent, and free-text replies. Adapters live in `packages/cli/src/adapters/` and run inside
the daemon. Read `claude.ts` (hooks plus a plugin mod) and `codex.ts` (a JSON-RPC client of Codex's app-server)
alongside this section.

An adapter implements `AgentAdapter` and talks to `Core` (`packages/cli/src/daemon/core.ts`):

```ts
export interface AgentAdapter {
  readonly agent: AgentKind                    // add yours to AgentKind in packages/protocol/src/wire.ts
  describe(): string                           // "myagent 1.4.2", shown by `agentwatch doctor`
  message?(sessionId: string, text: string): Promise<{ ok: true } | { ok: false; reason: string }>
  stop?(): void
}
```

| Core call | Use it when |
| --- | --- |
| `core.apply(agent, id, event, {text?})` | Something happened: `session.start`, `turn.start`, `turn.end {message}`, `session.end`, `info {title, cwd, …}`, `observed {state}` |
| `core.openRequest({agent, sessionId, kind, info, timeoutMs, match?})` | The agent is waiting on a person. `kind` is `permission` or `question`; `info.questions` carries the options. Await `req.done` for the phone's decision or answer, or the reason it closed. |
| `core.close(requestId, status)` | It was settled somewhere else: `answered_locally`, `expired`, `cancelled` |
| `core.setCaps(id, {reply, replyReason})` | Whether a phone reply can reach this session right now, and if not, why |

Core turns those into session states, the timeline, pushes (with the notify policy and delays) and sealed wire messages.
It also strips text under `summary` privacy, so an adapter hands over everything it knows and never seals anything.

Rules every adapter keeps:

- **Fail open.** If AgentWatch is down or slow, the agent behaves exactly as it would without it. Hooks exit 0 with no
  output, and nothing waits on the relay.
- **Use the agent's own interfaces.** Hooks, plugin APIs, the agent's RPC. No terminal scraping, no wrappers around
  the agent's process.
- **The first answer wins.** A request answered at the keyboard closes on the phone (`answered_locally`), and the
  reverse.
- **Tolerate versions.** Unknown events and fields are logged and ignored. If the agent's protocol changes shape,
  fall back to status-only rather than guessing.

Register the adapter in `startDaemon` (`packages/cli/src/daemon/main.ts`), behind a config switch if it touches the
agent's own setup. Test it against `Core` with a fake `send`, as `test/generic.test.ts` does. Base your fixtures on
payloads recorded from the real agent, as `test/fixtures/` does for Claude. To understand what crosses the network,
read [protocol.md](protocol.md).
