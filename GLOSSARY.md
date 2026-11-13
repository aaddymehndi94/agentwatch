# Glossary

Terms used in code, docs and UI. When a term here conflicts with casual usage, this file wins.

| Term | Meaning |
|---|---|
| **Relay** | The owner's Cloudflare Worker plus its single **Hub** Durable Object. It serves the app, stores sealed state, routes commands and sends Web Push. It never holds the vault key. |
| **Hub** | The one SQLite-backed Durable Object instance (`idFromName("hub")`) that holds all relay state and the sources' WebSockets. |
| **Owner** | The person who deployed a relay. One relay has exactly one owner. |
| **Source** | One running daemon, identified by host + OS user. It holds a long-lived outbound WebSocket to the Hub. |
| **Daemon** (`agentwatchd`) | The per-OS-user background process. It listens on a private unix socket, runs the adapters, applies the notify policy and talks to the relay. |
| **Adapter** | The daemon module that speaks to one kind of agent: `claude` (plugin hooks + mod), `codex` (app-server client), `generic` (`agentwatch ask`/`emit`). |
| **Agent** | A coding agent program (Claude Code, Codex, or a homemade one). |
| **Session** | One conversation of an agent: a Claude Code session id, or a Codex thread id. |
| **State** | A session's coarse status: `working`, `needs_you`, `idle`, `ended` or `unknown`. |
| **Turn** | One unit of agent work, from a user prompt until the agent stops. A turn's duration decides whether "done" pushes. |
| **Request** | Something an agent is waiting on a human for: a `permission` (approve/deny an action) or a `question` (pick option(s)). Opened by an adapter; closed when answered anywhere, expired or abandoned. |
| **Hold** | The Claude adapter keeps a `PermissionRequest` hook's connection open so the phone can answer. The terminal dialog stays live meanwhile, and the first answer wins. |
| **Command** | What a device sends back: `decide` (allow/deny), `answer` (question answers) or `message` (free-text reply; mid-turn, Claude queues it and Codex steers it into the running turn). |
| **Device** | A paired phone or browser. It holds a device token and the vault key in IndexedDB. |
| **Vault key** | The owner's 256-bit AES-GCM key. Every sealed field and command uses it. It lives only on sources and devices. |
| **Sealed** | Encrypted and authenticated with the vault key, with associated data binding it to its ids. |
| **Pairing** | The one-time flow that hands the vault key to a new device (`agentwatch pair`) or a new source (`agentwatch invite` → `agentwatch join`) without the relay seeing it. |
| **Privacy** | A per-source setting: `full` (sealed text is sent) or `summary` (no free text leaves the machine, only states and generic titles). |
| **Notify policy** | The daemon's rules for which state changes become pushes: `needs_you` always, done only for turns ≥ 30 s, start/end never. |
| **Mute** | An owner-wide relay flag that suppresses pushes until a time. |
| **Offline** | A source whose WebSocket has been gone ≥ 10 min while it had active sessions. Pushed once. |
