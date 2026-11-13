# v2 spike results (2026-11-13)

Run against real agents. Claude Code 2.1.323 (Haiku, in tmux, with `AGENTWATCH_HOME` pointed at an empty folder so the
real daemon never saw it). Codex 0.166.0 through a private `codex app-server --listen unix://…`, so the shared daemon
and AgentWatch never saw it. Fixtures: `packages/cli/test/fixtures/claude-2.1.323-busy-submit-usage.json` and
`codex-0.166.0-steer-ratelimits.jsonl`.

## Claude: `$.prompt.submit` while a turn runs — queues; resolves only when it enters
- **When submit resolves:** called 4 s into a running turn, `$.prompt.submit` stayed pending until the turn ended.
  It resolved 60 ms after `Stop`, when the queued prompt entered as its own turn.
  - **⇒** The mod must ack "queued" *before* awaiting submit. Otherwise a long turn trips the daemon's 30 s ack timer.
  - **⇒** It then acks again as delivered when submit resolves.
- **How the queued prompt runs:** as a normal turn. It gets its own `UserPromptSubmit` with plain `prompt` text, a new
  `prompt_id`, and a `Stop`.
  - The terminal labels it "Prompt from the <plugin> plugin".
  - `readPrompt` counts it as yours, which is right for a reply typed on the phone.
- **`turn.complete`:** fires per main-loop turn with `{answer, durationMs, isAborted, turnId, reason, usage}`.
  `reason` is one of `answer|aborted|refusal|error`.
  - `turn.start` / `turn.complete` with `agentId === undefined` give the mod a reliable busy flag.

## Claude: `$.session.usage()` works without a breakdown
After the first turn: `{startedAt, context: {tokens: 43086, window: 1000000, percent: 4}, rateLimits: [{kind:
'five_hour', percentUsed: 23, resetsAt: ISO}, {kind: 'seven_day', percentUsed: 54, resetsAt: ISO}], cost: {usd:
0.0043}}`. It's free to call (no `breakdown`).

## Codex: `turn/steer` goes into the running turn
- **Steering mid-turn:** `turn/steer {threadId, expectedTurnId, input}` (`expectedTurnId` is required) returned
  `{turnId}`, the same turn.
  - The text arrived as a second `userMessage` item in that turn, and the model answered it ("STEERED").
  - No new `turn/started` fires, so the adapter must not treat it as a new turn. It doesn't: `item/started userMessage`
    only starts a turn while `turnPending`.
- **Steering while idle:** with no active turn it fails with `{code: -32600, message: 'no active turn to steer'}`.
  - **⇒** Fall back to `turn/start`.

## Codex: rate limits and context
- **`account/rateLimits/read`:** returns `{rateLimits: {limitId: 'codex', primary: {usedPercent, windowDurationMins:
  300, resetsAt}, secondary: {usedPercent, windowDurationMins: 10080, resetsAt}, planType, rateLimitReachedType}}`.
  - `resetsAt` is in Unix **seconds** (Claude's is ISO).
- **Updates:** `account/rateLimits/updated` arrives during every turn with the same snapshot shape. Subscribe; no
  polling needed.
- **Context fill:** `thread/tokenUsage/updated` carries `tokenUsage.last.totalTokens` and `modelContextWindow`.
- **Cost:** Codex reports none (it's a subscription).

## Not captured
`StopFailure` and a failed Codex `turn/completed`: neither can be triggered on purpose without spending real quota
until a limit. Build against the typed shapes:
- Claude: `{error: SDKAssistantMessageError, error_details?, last_assistant_message?}`.
- Codex: `turn.status: 'failed'`, `turn.error: {message, codexErrorInfo, additionalDetails}`; also `error`
  notifications with `willRetry`.

Capture real ones when they happen.
