# 11: Review, security review, docs and CI

**What to build:** The repo is ready to share publicly. That means a code review and a security review with their findings fixed, plus a README covering deploy, setup, pairing and screenshots (and the Deploy-to-Cloudflare button), SECURITY.md (threat model and honest limits), CONTRIBUTING.md, LICENSE (MIT), docs/architecture.md, and GitHub Actions CI (typecheck, lint, test).

**Blocked by:** 01–10

**Status:** done

- [x] /code-review + /security-review on the full diff; findings fixed or recorded
- [x] README, SECURITY.md, CONTRIBUTING.md, LICENSE, docs/architecture.md
- [x] .github/workflows/ci.yml green locally (act-free: same commands)
- [x] No secrets in git history (scan)

## Notes

### Code review: 10 findings, all fixed (commit "Fixes from the code review")

- Commands go only to a live socket. Unacked ones are resent on reconnect, and a resent command gets its original ack.
- A socket that closes mid-snapshot no longer drains the queue or leaks a ping timer.
- After a crash, the hook waits for a daemon that accepts connections, not for the socket file.
- Other fixes:
  - a restart while blocked stays `needs_you`;
  - ending a generic session cancels its ask;
  - VAPID creation is race-safe;
  - Codex has its own hold time;
  - app refreshes are applied in order.

### Security review: 2 high, 3 medium, 5 low

**High**
1. **Approve on a notification could approve a different request.** The relay could replay a sealed push with another `requestId`.
   - The push seal now covers every clear field the service worker acts on.
   - Buttons appear only on a verified permission push whose tag names its request.
   - The request seal also covers its kind, and Core refuses `decide` on a question.
2. **Joined OS users could control each other.** Every source holds the vault key, and any source could pair a phone.
   - Pairing (phones and invites) and `rotate` are now owner-only on the relay.
   - Recovery from a lost owner is a new `CLAIM_SECRET` followed by `setup --force`.
   - Residual risk (a joined user colluding with the relay's storage) is SECURITY.md limit 6.
   - Phone-signed commands are ticket 12.

**Medium**
3. **Approval text could hide the command.** Exact literals are now shown, with newlines kept. Non-built-in tools show their full input, never the agent's description. A command over 8,000 characters is cut, marked, and answered at the computer. A notification's Approve appears only when its one-line body shows everything.
4. **A launcher could run Node from another user's home.** Only binaries owned by root or this user, and not writable by others, are used. Otherwise `join` and `setup` copy Node into the user's own install folder. `--node` is checked the same way.
5. **`join` handed control over silently.** It now spells out what the relay owner gets and asks y/N (`--yes` when piped). It also requires https.

**Low**
6. Relay URLs must be https, or http on loopback.
7. Timeline events are bound to the session being shown.
8. Mute is capped at a week. The Settings copy for removing a phone now points to `rotate`.
9. The claim secret is asked for, or read from the environment, instead of argv.
10. Hardening:
    - `hook.sh` runs only a launcher it owns (`-O`), and the hook skips a state folder it doesn't own.
    - The app has a CSP and anti-framing headers (`_headers`), checked in E2E and in Chrome.
    - Not done, recorded: the vault key as a non-extractable `CryptoKey` (ticket 12), and replies not tied to a turn (limit 7).

### Re-check of the security fixes

The reviewer re-checked the fixes against the code. 1, 5, 6 and 7 were closed. Fixed after the re-check:

- **Older relays:** a relay claimed before owners existed would have refused everyone. The first source now becomes
  its owner, and the current secret is recorded as used.
- **Edits:** Claude's Edit, Write, MultiEdit and NotebookEdit now show the change (`-`/`+` lines), not just the path.
  Codex file changes show their diffs, and one without a diff is answered at the computer.
- **Hidden characters:** invisible and bidi control characters are spelled out as `⟨U+XXXX⟩` in what you approve.
- **Reply mod:** it now checks, through `sh`, that the socket and its folder belong to this user, since the mod API's
  `stat` has no owner. The config must be owned by this user too. The hook checks the nearest existing folder when
  the state folder doesn't exist yet.
- **Node check:** it now walks every folder and every link up to `/`. Sticky folders are fine, and group write is
  allowed only for a group with no other members (`own.ts`).
- **Relay:**
  - a source keeps the name from its first hello;
  - request upserts are scoped to their source;
  - the relay's own unsealed text appears only on offline and test pushes.
- **SECURITY.md:** says the owner account is trusted with every joined user (limit 6), and fixes the overclaims.

Left as they are, and documented:

- mute can be renewed a week at a time;
- any phone can remove another;
- device tokens don't expire;
- `--claim-secret` still works as a flag, and the prompt echoes the secret.

### Publishing checklist (for the owner)

- **Authorship:** commits are authored with a work email address. Re-author before making the repo public if that isn't intended:
  - `git rebase -r --root --exec 'git commit --amend --no-edit --reset-author'`, after setting `user.email`;
  - or `git filter-repo --mailmap`.
- **OS usernames:** the first 11 commits contain OS usernames in `PRODUCT.md` and `.scratch/v1/spike-results.md`. The current tree is clean. To scrub history, squash it or rewrite those two files with `git filter-repo`.
- **Deploy button:** the Deploy-to-Cloudflare button needs a public repo URL, so it is deferred. The README documents `relay deploy` and `setup` instead.
- **CI:** `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm test` passes locally (11 files, 111 tests).
