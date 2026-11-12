# Product

<!-- impeccable:product-schema 1 -->

> Written 2026-11-12 from the owner's brief, the approved plan, and one interview round on usage moments.
> Items marked *(assumption)* are unconfirmed.

## Platform

web

An installable PWA used on a phone first: Android Chrome "Install app", iPhone Safari "Add to Home Screen" (iOS 16.4+).
The relay also serves the same app to desktop browsers, but the phone is the design target.

## Stack

Delegated, then confirmed in planning:
- TypeScript everywhere, in a pnpm workspace.
- **App:** Vite + Preact PWA, with a hand-written service worker.
- **Relay:** Cloudflare Worker with one SQLite-backed Durable Object ("Hub").
- **Laptop side:** a Node ≥ 22 daemon, CLI and hook, plus a Claude Code plugin (command hooks and a mod).
- **Cost:** everything has to fit Cloudflare's free plan.

## Users

- **The owner:** one developer running many Claude Code and Codex sessions at once, across several Linux users on one
  laptop. Some sessions run in tmux under another user's desktop session.
- **Developers the owner gives it to:** each deploys their own relay for their own agents and repos, and adds
  `agentwatch ask` to agents they build themselves. They set it up without help, so first-run has to explain itself.

**Usage moments** (confirmed):
1. Outside, while the laptop sits at home running things: away from the desk, with no terminal at hand.
2. Quick glances: a notification arrives, the person decides within seconds, the phone goes back in the pocket.
3. Overnight and long unattended runs: checking at odd hours, often in the dark, to unblock one agent.

At the desk as a second screen is *not* a primary moment.

## Product Purpose

AgentWatch is a pager for coding agents. It tells you when an agent needs you or has finished, shows every running
session across machines and OS users in one list, and lets you answer from the phone: approve or deny an action, answer
the agent's question, or send a short follow-up.

Success means an agent never sits blocked for hours because nobody saw its prompt, and the owner can leave the laptop
running at home without anxiety.

## Positioning

- **Self-hosted on the owner's own free Cloudflare account:** no app store, no third-party push app, no subscription.
- **End-to-end encrypted:** Cloudflare relays ciphertext. Prompts, commands and replies are readable only on the
  laptop and on paired phones.
- **Adapters, not wrappers:** it watches agents the way they are already launched, through Claude Code's plugin
  hooks and mods and Codex's shared app-server. Nobody changes how they start agents.
- **Multi-agent and multi-user:** one inbox for Claude Code and Codex, across OS users and machines.
- **Generic:** any script or homemade agent can ask the human through `agentwatch ask`.

Nearby products, and where they stop short:
- Happy and Happier: you install their client.
- nofax: depends on ntfy, and its Cloudflare mode only notifies.
- Claude Remote Control: paid, and Claude only.
- Codex remote-control: ChatGPT only.

## Operating Context

- **Answering.** Agents ask for permission (shell commands, file edits) or ask a multiple-choice question. The
  laptop's terminal dialog stays live while the phone holds the same request, and the first answer wins.
- **Replies.** Free-text replies arrive in the session as if the user had typed them.
- **When the phone isn't in hand.** Pushes go through Web Push. Android shows Approve/Deny buttons on the
  notification itself. iOS opens the request with one tap.
- **The laptop.** It only connects out (one WebSocket). If the laptop goes to sleep, loses network or its desktop
  session ends, the phone still shows the last known state and gets one "offline" push.
- **The owner's work OS user** runs with `summary` privacy: no message text ever leaves that
  machine, only states like "Claude finished in <project>".

## Capabilities and Constraints

- **v1:** push for `needs_you` and done (turns ≥ 30 s); an overview of sessions grouped by host and user;
  approve/deny; answering AskUserQuestion; a free-text reply to an idle session; mute; an offline alert;
  multi-device pairing; per-source privacy.
- **Not in v1:** transcripts, starting new sessions from the phone, a shared team relay, a native app, Windows.
- **Agents covered:** Claude Code ≥ 2.1.287, where mods exist; the reference build is 2.1.322. Codex sessions launched
  with `-c`/`--enable`/`--disable`/`--search` run in embedded mode and are notify-only.
- **Free-tier limits:** Workers 100k requests/day, Durable Objects 100k requests/day. Pushes should be well under
  100/day per person.
- **Never in git:** tokens and keys.

**Vocabulary:**

| Term | Meaning |
|---|---|
| Relay | The owner's Cloudflare Worker and its Hub Durable Object |
| Source | One daemon (host plus OS user) |
| Session | A Claude session or a Codex thread |
| Request | Something waiting on the human |
| Command | The phone's answer |
| Device | A paired phone |
| Vault key | The end-to-end key |

## Brand Commitments

The name is **AgentWatch**. The voice is plain and calm: a pager, not a dashboard full of noise. *(assumption)* No
logo or visual identity exists yet.

## Evidence on Hand

- **Real recorded payloads:** Claude Code 2.1.322 hooks and Codex 0.166 app-server messages, in
  `packages/cli/test/fixtures/`.
- **Spike results:** `.scratch/v1/spike-results.md`.
- **No user testimonials, metrics or screenshots exist yet.** Don't fabricate any.

## Product Principles

1. **Never get in the agent's way.** If AgentWatch is down or slow, agents and terminals behave exactly as without it.
2. **The phone is a pager, not a terminal.** Show the decision and enough context to make it safely, then get out of the way.
3. **Glanceable first.** Whatever needs the human is at the top. Everything else is calm and quiet, including at 3 a.m. in the dark.
4. **Your relay, your keys.** Free and self-hosted, with nothing readable by the infrastructure.
5. **Explain itself.** A developer the owner hands it to gets from zero to a test push without asking anyone.

## Accessibility & Inclusion

*(assumption)* WCAG 2.2 AA:
- touch targets of at least 44 px;
- respects system dark mode and reduced motion;
- readable at a glance in sunlight and in the dark;
- Approve and Deny are never distinguished by color alone.
