# Security

AgentWatch can approve commands on your computer from your phone, so its security matters as much as your shell's.
This page says what it protects, how, and where the protection stops.

## Reporting a vulnerability

Please report it privately through GitHub's **Report a vulnerability** button (repository → Security → Advisories),
not in a public issue. Include what an attacker needs and what they gain. We aim to answer within a week.

## What is protected, from whom

| Party | Can | Can't |
| --- | --- | --- |
| **Your relay** (Cloudflare, or anyone who reads its storage or traffic) | See ids, agent kinds, session states, timestamps, `user@host` names, privacy settings and versions; drop or delay messages | Read prompts, commands, file paths, questions, answers, replies or snippets; forge or replay an approval; move sealed content from one request to another |
| **A network attacker** | See that you use your relay (TLS hides the rest) | Anything the relay can't |
| **Apple's or Google's push service** | See push timing and size | Read pushes: they're encrypted per RFC 8291, and the content is sealed again with your vault key |
| **A revoked or rotated phone** | Nothing new: its token is deleted at once | Read new data after `agentwatch rotate`, or act after its token is revoked |
| **Another OS user on your computer** | See that AgentWatch is installed | Read your config or key (0600), talk to your daemon (socket 0600 in a 0700 folder), or steer your agents. Each user has their own daemon and token. |
| **Text from the agent** shown on the phone | Show up as text | Run script in the app: it is rendered as text, never as HTML |

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
  - the request is still open;
  - for free text: this computer allows messages, and the session is idle.

  The relay only forwards commands, so it can't forge one.
- **Pairing never exposes the key.** `agentwatch pair` uploads the vault key wrapped under a one-time secret. That
  secret travels only in the link's `#fragment`, which browsers don't send to servers. The relay deletes the wrapped
  key on first use, or after 10 minutes. `agentwatch join` reads its invite from stdin, so it doesn't land in your
  shell history.
- **Relay ownership.** `agentwatch relay deploy` sets a random `CLAIM_SECRET` and claims the relay at once. A relay
  only gives out a first token to whoever knows that secret, and only once. Phones and other computers get tokens
  only through one-time pairings. The relay stores tokens SHA-256 hashed, and a device token can't act as a source.
- **Least privilege on the computer.** Nothing runs as root, and nothing listens on the network: the daemon connects
  out to your relay over one WebSocket. Hooks only talk to your own daemon's unix socket, and fail open.
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
6. **Availability isn't guaranteed.** Anyone can send requests to your Worker and use up your free-plan quota. If
   your relay or computer is offline, nothing is lost: the agent's own dialog keeps working, and the phone shows the
   last known state.
