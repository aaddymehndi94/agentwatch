# 00: Spike — record the new agent surfaces before building on them

**What to build:** Throwaway captures (in `spikes/v2/`, gitignored) of every surface v2 relies on, saved as fixtures.

- Claude mod: when `$.prompt.submit` resolves while a turn runs; whether the queued prompt runs as its own turn with
  its `UserPromptSubmit`; `turn.complete`'s shape; `$.session.usage()` after a turn.
- Codex app-server: `turn/steer` on a running TUI thread; `account/rateLimits/read`.
- `StopFailure` and a failed Codex turn: typed shapes, real ones if they turn up.

**Status:** in-progress

- [ ] Results in `.scratch/v2/spike-results.md`
- [ ] Fixtures in `packages/cli/test/fixtures/`
