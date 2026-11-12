# 03: Push — needs-you and long-turn-done reach the phone

**What to build:** The phone can turn notifications on. The Hub keeps VAPID keys and subscriptions. The daemon's notify policy emits a push for `needs_you`, and for done when the turn took ≥ 30 s. The service worker decrypts the payload and always shows a notification, falling back to generic text. Tapping it opens the session. Includes test push and mute (1 h / until 08:00).

**Blocked by:** 02

**Status:** done

- [x] protocol: notify policy (tests: needs_you, done ≥ 30 s vs < 30 s, no start/end, summary privacy text)
- [x] relay: VAPID generated in the DO; subscription endpoints; Web Push via @block65/webcrypto-web-push sent from the Hub; prune 404/410; mute flag
- [x] relay test: a reference RFC 8291 receiver decrypts what we send (S4)
- [x] app: notifications toggle + test push in Settings; service worker push → decrypt → showNotification (tag per session); notificationclick deep link
- [x] cli: `agentwatch doctor --test-push`, `agentwatch mute`

**Notes:** `packages/relay/test/push.test.ts` decrypts what the Hub sends with an independent RFC 8291 receiver (node:crypto) and verifies the VAPID JWT, which closes S4. The daemon asks the Hub to ack test pushes and reports why nothing went out ("no phone has notifications on", "muted", "push service refused it"). A test push gets through even while muted. A real phone delivery is part of the morning hand-off.
