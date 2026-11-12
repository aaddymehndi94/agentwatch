# Security

AgentWatch can approve commands on your computer from your phone, so its security matters as much as your shell's.
This page says what it protects, how, and where the protection stops.

## Reporting a vulnerability

Please report it privately through GitHub's **Report a vulnerability** button (repository → Security → Advisories),
not in a public issue. Include what an attacker needs and what they gain. We aim to answer within a week.

## What is protected, from whom

| Party | Can | Can't |
| --- | --- | --- |
| **Your relay** (Cloudflare, or anyone who reads its storage or traffic) | See ids, agent kinds, session states, timestamps, `user@host` names, privacy settings and versions; drop or delay messages; show a notification of its own | Read prompts, commands, file paths, questions, answers, replies or snippets; forge or replay an approval; move sealed content from one request, session or notification to another; put Approve on a notification it made or altered |
| **A network attacker** | See that you use your relay (TLS hides the rest) | Anything the relay can't |
| **Apple's or Google's push service** | See push timing and size | Read pushes: they're encrypted per RFC 8291, and the content is sealed again with your vault key |
| **A revoked or rotated phone** | Nothing new: its token is deleted at once | Read new data after `agentwatch rotate`, or act after its token is revoked |
| **Another OS user on your computer** | See that AgentWatch is installed | Read your config or key (0600), talk to your daemon (socket 0600 in a 0700 folder), or steer your agents. Each user has their own daemon and token. |
| **An OS user or computer you joined** to your relay (say, an agent there went rogue) | Report its own sessions, under the name it joined with; mute notifications, a week at a time | Rename itself to pass for another machine; pair a phone, invite a computer or rotate the key: only the owner can. So it gets no phone token, and can't read or steer the other users' agents through AgentWatch. |
| **An agent's own text** shown on the phone | Show up as text | Run script in the app (it is rendered as text, never as HTML); hide part of a command or edit behind a comment, a description or invisible characters (you see the exact command, diff or tool input, line breaks and all, with invisible and direction-changing characters spelled out) |

## How

- **End-to-end encryption.** There's one 256-bit vault key, shared by your computers and paired phones. Everything a
  human wrote or would read is sealed with AES-256-GCM before it leaves the computer. Each sealed item is bound
  (through associated data) to what it belongs to: source, session, request, event or push. A blob only opens in its
  own place.
- **Commands are sealed and checked.** An approval, answer or reply from the phone is sealed with the vault key and
  bound to its device, source, session, request, kind, timestamp and a random nonce. Before applying it, the daemon
  requires that:
  - the seal opens under that binding;
  - the timestamp is within ±5 minutes of its clock, and not before the daemon started;
  - the nonce is new;
  - the request is still open, and the command fits it: approve or deny only a permission, answer only a question;
  - for free text: this computer allows messages, and the session is idle.

  The relay only forwards commands, so it can't forge one.
- **What you approve is what runs.** The phone shows the exact command, the file and the change to it (old lines `-`,
  new lines `+`), or the tool's full input. Never the agent's own description of it. Line breaks are kept, and
  invisible or direction-changing characters are spelled out as `⟨U+202E⟩`. Anything longer than 8,000 characters is
  cut, says so, and can only be answered at the computer, as is a Codex edit whose diff it doesn't have. Approve appears on a notification only when the notification shows the whole command
  (one line of at most 180 characters), and only if the push opened under its seal. That seal covers the request,
  session, kind and buttons the notification acts on, so the relay can't point Approve at a different request.
- **Pairing never exposes the key.** `agentwatch pair` uploads the vault key wrapped under a one-time secret. That
  secret travels only in the link's `#fragment`, which browsers don't send to servers. The relay deletes the wrapped
  key on first use, or after 10 minutes. `agentwatch join` reads its invite from stdin, so it doesn't land in your
  shell history.
- **Relay ownership.** `agentwatch relay deploy` sets a random `CLAIM_SECRET` and claims the relay at once, making that
  OS user the owner. A relay only gives out a first token to whoever knows that secret, and only once per secret.
  Phones and other computers get tokens only through one-time pairings, and only the owner can create those, or
  rotate the key. The relay stores tokens SHA-256 hashed, and a device token can't act as a source.
- **Joining asks first.** `agentwatch join` names the relay and spells out what its owner gets (reading, approving,
  replying) before it uses the invite. Relay URLs must be `https` (plain `http` only on localhost), so a token never
  crosses the network in the clear.
- **Least privilege on the computer.** Nothing runs as root, and nothing listens on the network: the daemon connects
  out to your relay over one WebSocket. Hooks only talk to your own daemon's unix socket, and fail open. They only run
  a launcher this user owns, with a Node binary that only this user or root can change; a user without one gets a
  private copy. A `HOME` or `XDG_*` folder leaked from another account (tmux started from someone else's desktop)
  can't lead a hook, the reply mod or the daemon to another user's launcher, socket or config.
- **A locked-down app.** The relay serves the app with a Content Security Policy that allows only its own scripts and
  its own relay, and forbids framing.
- **Summary privacy.** With `--privacy summary`, a computer sends no free text at all: only states, the project folder
  name and the model.

## Honest limits

1. **Your relay serves the phone app.** Whoever controls your Cloudflare account, or the code you deploy, could ship a
   modified app that reads the key from the phone. End-to-end encryption protects you from the platform storing and
   relaying your data, not from someone who can change the app. Protect your Cloudflare account with two-factor
   authentication, and deploy from a checkout you trust.
2. **Metadata is visible to the relay:** host and OS user names, how many sessions you run, when they need you, how
   long they take, and which agent each is.
3. **A paired phone is as powerful as your keyboard.** Anyone holding it unlocked can approve commands or type into an
   idle agent. Use `--no-messages` on computers where phone replies aren't worth that risk. For a lost phone, remove it
   in Settings on another phone, or run `agentwatch rotate` to replace the key everywhere.
4. **Your own OS user is trusted.** Anything that runs as you can read your AgentWatch config and talk to your daemon,
   just as it could type into your terminal. AgentWatch doesn't defend against malware already running in your
   account.
5. **No forward secrecy.** The vault key is static until you rotate it. Ciphertext the relay still holds (events for 7
   days, ended sessions for 3) is readable by anyone who later gets the key.
6. **The owner account is trusted with all of them.** Whatever runs as the owner can pair a phone, and so read and
   steer every joined user's agents. `join` on the same computer also installs the owner's copy of AgentWatch. If an
   account runs agents you don't fully trust, don't make it the owner: deploy from an account that runs none.
7. **Joined users share the vault key.** Every computer and OS user on a relay seals with the same key. The relay keeps
   them apart (only the owner gets phones), but someone who controls a joined OS user *and* your relay's storage could
   read, or forge commands for, the others. Join only accounts you'd trust with each other's agent traffic, and use
   `--privacy summary` for a work account. Signing commands per phone is planned.
8. **A reply isn't tied to a turn.** The relay can't forge or replay a reply, but it can hold one back for up to 5
   minutes, so "yes, go ahead" may land on a later idle moment than the one you answered.
9. **Summary privacy approves blind.** Under `--privacy summary` the phone sees "wants to use Bash" without the
   command. If that's too little to go on, answer at the computer; the phone still tells you something is waiting.
10. **Availability isn't guaranteed.** Anyone can send requests to your Worker and use up your free-plan quota. If
   your relay or computer is offline, nothing is lost: the agent's own dialog keeps working, and the phone shows the
   last known state.
