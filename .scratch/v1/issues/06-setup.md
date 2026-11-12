# 06: Setup — any developer gets from zero to a paired phone

**What to build:** `agentwatch relay deploy` deploys the relay to the developer's Cloudflare account via wrangler and claims it. `agentwatch setup` installs the bundle + launcher (absolute Node ≥ 22 path), installs the Claude plugin from a local marketplace at user scope, writes config (0600) and starts the daemon. `agentwatch invite` / `agentwatch join` (code on stdin) add more OS users or machines with privacy flags. `agentwatch doctor` checks every link and says what to fix. Optional systemd user unit / launchd plist. `uninstall` reverses it. Every edited file is backed up, and every step is idempotent.

**Blocked by:** 02

**Status:** done

- [x] `relay deploy` (wrangler login detection, CLAIM_SECRET secret, deploy, claim) — or `setup --relay URL --claim-secret` for Deploy-button users
- [x] `setup` / `uninstall` idempotent, with backups; detects Claude/Codex versions
- [x] `invite` / `join` one-time flow (protocol + relay), `--privacy summary|full`, `--no-messages`
- [x] `doctor` (daemon, socket perms, plugin installed/enabled, relay reachable, push subscriptions via `--test-push`; Codex checks land with 07)
- [ ] ~~systemd user unit + launchd plist~~ — dropped for v1: hooks start the daemon on demand, and the daemon only has work while an agent runs, so a unit adds a moving part without a benefit
- [x] tests: setup on a temp HOME is idempotent and preserves existing settings keys

**Notes:**
- **How setup installs the plugin:**
  - It goes through a one-plugin local marketplace (`agentwatch-local`, in `~/.local/share/agentwatch/marketplace`) and `claude plugin marketplace add` / `install --scope user`.
  - Claude's own CLI edits its settings. We back up `settings.json` and `known_marketplaces.json` (`*.agentwatch-<stamp>.bak`) right before the first command that changes anything.
  - A re-run with nothing to do changes nothing and backs nothing up.
- **Live check: a marketplace-installed plugin loads its mod too.**
  - Done at local scope in the spike project, without `--plugin-dir`: the mod connected (`reply: true`), and a phone reply ran as a Claude turn.
  - Then it was uninstalled. The test left empty `enabledPlugins` / `extraKnownMarketplaces` keys and a plugin cache dir; I removed those, and the user's Claude config was verified unchanged against backups.
- **Choosing Node for the launchers:** setup prefers the newest Node 22+ that the user owns (nvm, fnm, volta, PATH) or the system's, so a launcher never depends on another user's home.
- **Running a test as another OS user:** `invite` prints the exact `sudo -iu <user> … join` line to run.
