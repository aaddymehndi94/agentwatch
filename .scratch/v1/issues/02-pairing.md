# 02: Pairing — `agentwatch pair` puts a phone on the relay

**What to build:** `agentwatch pair` prints a QR code and a link carrying a one-time pair id and secret. Opening the link (Android), or pasting it inside the installed app (iOS), claims the pairing. The device gets a device token, unwraps the vault key, stores both in IndexedDB and shows the live, decrypted session list. The relay never sees the secret, and the pairing dies after one claim or 10 min. Devices can be listed and revoked.

**Blocked by:** 01

**Status:** done

- [x] protocol: pairing wrap/unwrap (HKDF + AES-GCM, pair id as associated data); tests including an expired/claimed pairing
- [x] relay: pair.create over the source WS; `POST /api/pair/claim` one-time; `GET/DELETE /api/devices`
- [x] cli: `agentwatch pair` (terminal QR + link + expiry)
- [x] app: Pair screen (link route + paste-link field), iOS "Add to Home Screen first" guidance, error states (expired, already used, offline)
- [x] E2E: harness pairs a fake device through the real flow and reads decrypted state

**Notes:** Covered by the E2E harness (`packages/cli/test/e2e.test.ts`): a fake phone pairs through the real daemon and relay, a pairing code works once (second claim → 410), and a phone removed from Settings gets 401 straight away. The pair screen was checked at 390×844 in both themes. The real-phone run (Android + iPhone Home Screen) is part of the morning hand-off.
