# AgentWatch

A pager for your coding agents. A per-OS-user daemon watches Claude Code and Codex sessions and relays them, end-to-end
encrypted, through the owner's own free Cloudflare Worker + Durable Object to an installable phone PWA. That PWA pushes
when an agent needs you and lets you approve, deny, answer or reply. See `README.md`, `docs/architecture.md` and
`GLOSSARY.md`.

## Runtime

- Node 24 via nvm (`nvm use` reads `.nvmrc`). Some machines default to Node 18, which is too old (the CLI needs ≥ 22).
- pnpm workspaces: `packages/protocol`, `packages/relay`, `packages/app`, `packages/cli`, plus `plugins/claude-code`.

## Working rules

- Plan and build with the mattpocock engineering skills: `/to-spec` → `/to-tickets` → `/implement` + `/tdd`, `/prototype`
  for throwaway spikes, `/code-review` before calling a ticket done.
- Every UI change goes through the impeccable skill (`/impeccable shape|critique|polish|audit`), and is checked in the
  rendered app at phone size (390×844) in light and dark.
- Never commit secrets: relay URLs with tokens, vault keys, `.dev.vars` and `wrangler` account ids stay out of git.
- Hooks must fail open. If the daemon is down, a hook exits 0 within ~1 s with no stdout, so agents behave exactly as
  they would without AgentWatch.
- Generic over specific: no hard-coded users, hosts or paths. Machine-specific values come from config or detection.

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The default five canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
