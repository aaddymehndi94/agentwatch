# 03: Push — needs-you and long-turn-done reach the phone

**What to build:** The phone can turn notifications on. The Hub keeps VAPID keys and subscriptions. The daemon's notify policy emits a push for `needs_you`, and for done when the turn took ≥ 30 s. The service worker decrypts the payload and always shows a notification, falling back to generic text. Tapping it opens the session. Includes test push and mute (1 h / until 08:00).

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] protocol: notify policy (tests: needs_you, done ≥ 30 s vs < 30 s, no start/end, summary privacy text)
- [ ] relay: VAPID generated in the DO; subscription endpoints; Web Push via @block65/webcrypto-web-push sent from the Hub; prune 404/410; mute flag
- [ ] relay test: a reference RFC 8291 receiver decrypts what we send (S4)
- [ ] app: notifications toggle + test push in Settings; service worker push → decrypt → showNotification (tag per session); notificationclick deep link
- [ ] cli: `agentwatch doctor --test-push`, `agentwatch mute`
