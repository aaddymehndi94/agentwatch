# 06: Setup — any developer gets from zero to a paired phone

**What to build:** `agentwatch relay deploy` deploys the relay to the developer's Cloudflare account via wrangler and claims it. `agentwatch setup` installs the bundle + launcher (absolute Node ≥ 22 path), installs the Claude plugin from a local marketplace at user scope, writes config (0600) and starts the daemon. `agentwatch invite` / `agentwatch join` (code on stdin) add more OS users or machines with privacy flags. `agentwatch doctor` checks every link and says what to fix. Optional systemd user unit / launchd plist. `uninstall` reverses it. Every edited file is backed up, and every step is idempotent.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] `relay deploy` (wrangler login detection, CLAIM_SECRET secret, deploy, claim) — or `setup --relay URL --claim-secret` for Deploy-button users
- [ ] `setup` / `uninstall` idempotent, with backups; detects Claude/Codex versions
- [ ] `invite` / `join` one-time flow (protocol + relay), `--privacy summary|full`, `--no-messages`
- [ ] `doctor` (daemon, socket perms, plugin installed/enabled, Codex daemon reachable/embedded, relay reachable, push subscriptions)
- [ ] systemd user unit + launchd plist (optional; only when a user manager exists)
- [ ] tests: setup on a temp HOME is idempotent and preserves existing settings keys
