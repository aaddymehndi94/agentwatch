# 12: Phone-signed commands, so joined users can't forge approvals even with the relay's help

**What to build:** Every source holds the one vault key, so in principle any joined OS user can seal a command for
another. Since ticket 11, the relay only lets the owner pair phones, so a joined user gets no device token to post one.
That holds as long as the relay is honest. Make it hold without the relay too: commands carry a signature that only
phones (and the owner) can make, and every source checks it.

Sketch, the smallest version:

- The owner source gets an ECDSA P-256 **control key** pair at claim or rotate. Its private half goes to phones inside
  the pairing wrap (next to the vault key); invites carry only its public half.
- The phone stores it as a non-extractable `CryptoKey` in IndexedDB, and signs each command's binding and seal. The
  service worker signs Approve/Deny from a notification the same way.
- `verifyCommand` also checks the signature against the control public key from config. The daemon rejects unsigned
  commands.
- `rotate` replaces the control key with the vault key. A joined user that wants its own phones would need a control
  key of its own, trusted by itself only (out of scope unless asked for).
- While at it, consider storing the vault key in the phone as a non-extractable `CryptoKey` too.

**Blocked by:** 11

**Status:** needs-triage

- [ ] Wire: `CommandEnvelope.sig`; pairing wrap carries `{k, ck}`; invite carries `{k, cpub}`
- [ ] App and service worker sign; daemon verifies; old unsigned commands rejected
- [ ] Tests: a source with the vault key but no control key can't get a command applied, even posted by the relay
- [ ] SECURITY.md limit 6 rewritten

## Why it isn't in v1

The security review (ticket 11) found that joined users could control each other. Ticket 11 closed that with the
relay's owner-only rule, which needs no wire change. Signing touches pairing, the app, the service worker and every
command, and nothing about it is urgent while the relay is your own Cloudflare account.
