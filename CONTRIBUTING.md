# Contributing

Thanks for helping. AgentWatch is small on purpose, so the bar is less "more features" and more "never get in the
agent's way, and never leak what the agent is doing".

## Setup

```sh
nvm use                       # Node 24 (from .nvmrc); 22.12+ works
corepack enable && pnpm install
pnpm build                    # the phone app and the CLI bundle
pnpm test                     # unit tests and the E2E harness (workerd; no Cloudflare login needed)
pnpm typecheck && pnpm lint   # tsc in every package; Biome for lint and format
```

`pnpm dev:relay` runs a local relay with the app at `http://localhost:8787`. Copy `packages/relay/.dev.vars.example`
to `packages/relay/.dev.vars` first, so the local relay has a claim secret. Add `/?demo` to try the app without
pairing, or `?demo=calm`, `?demo=new`, `?demo=offline` for the other states.

To try the daemon against it without touching your real setup, give it its own home:

```sh
export AGENTWATCH_HOME=/tmp/aw-dev
node packages/cli/dist/agentwatch.mjs setup --relay http://localhost:8787 --claim-secret <CLAIM_SECRET from packages/relay/.dev.vars> --no-claude
```

## Where things live

Start with [docs/architecture.md](docs/architecture.md), then [docs/protocol.md](docs/protocol.md). Domain words
(source, session, request, command, device) are defined in [GLOSSARY.md](GLOSSARY.md). Use them the same way in
code and copy.

## Rules that aren't negotiable

1. **Hooks fail open.** If the daemon is down, slow or broken, a hook exits 0 within about a second with no stdout, and
   the agent behaves exactly as it would without AgentWatch. The E2E tests check this; keep them passing.
2. **Text leaves the machine only sealed,** and only through `Core`, which applies `summary` privacy. Adapters never
   seal or send anything themselves.
3. **No secrets in git:** no tokens, vault keys, `.dev.vars`, account ids or relay URLs with credentials.
4. **Generic over specific:** no hard-coded users, hosts or paths. Machine-specific values come from config or
   detection.
5. **Adapters, not wrappers:** integrate through the agent's own hooks, plugins or RPC, never by scraping a terminal
   or wrapping the agent's process.

## Changes

- Write the test first where you can. Core and the adapters are unit-tested against recorded payloads
  (`packages/cli/test/fixtures/`). Anything that crosses the network belongs in the E2E harness.
- UI changes follow [DESIGN.md](DESIGN.md). Check them at phone size in light and dark (`pnpm --filter @agentwatch/app
  screenshots` regenerates `docs/screenshots/`), with 44px targets and nothing distinguished by colour alone.
- Changing the wire format means updating `packages/protocol/src/wire.ts`, `docs/protocol.md`, and both ends. Old
  daemons and old phones meet new relays in the wild; prefer additive changes.
- Write copy plainly. Say what happened and what to do next.

Before you open a pull request, run `pnpm build && pnpm typecheck && pnpm lint && pnpm test`. CI runs the same commands.

## Security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).
