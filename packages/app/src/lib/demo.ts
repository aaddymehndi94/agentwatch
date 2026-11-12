// `?demo` mode: a believable, clearly synthetic workload for trying the app and for screenshots. No relay needed.

import type { SourceView } from '@agentwatch/protocol'
import type { EventVM, Model, RequestVM, SessionVM } from './model.ts'

const min = 60_000

/** `?demo` variants, for trying states without a relay: `calm` (nothing waiting), `new` (no computers yet),
 * `offline` (the relay can't be reached; set up in the store). */
export type DemoVariant = 'full' | 'calm' | 'new' | 'offline'

export function demoModel(now = Date.now(), variant: DemoVariant = 'full'): Model {
  if (variant === 'new') return { serverTime: now, skew: 0, mute: null, sources: [], sessions: [], requests: [] }
  const sources: SourceView[] = [
    src('laptop-a', 'dev', 'laptop', 'full', true),
    src('laptop-b', 'dev-work', 'laptop', 'summary', true),
    src('server', 'ci', 'build-box', 'full', false, now - 40 * min),
  ]
  const sessions: SessionVM[] = [
    sess('laptop-a', 's1', 'claude', 'needs_you', now - 4 * min, {
      project: 'api-server',
      title: 'Migrate the billing webhooks to the queue',
      snippet: 'Running the migration against the local database before touching the handlers.',
      cwd: '/home/dev/src/api-server',
    }),
    sess('laptop-a', 's2', 'codex', 'needs_you', now - 41 * min, {
      project: 'mobile-app',
      title: 'Release notes for 3.8',
      snippet: 'Drafted the notes from the merged PRs; two items need a decision.',
    }),
    sess('laptop-a', 's3', 'claude', 'working', now - 7 * min, {
      project: 'design-tokens',
      title: 'Generate the dark palette',
      snippet: 'Checking contrast for every text/background pair.',
    }),
    sess('laptop-a', 's4', 'claude', 'idle', now - 23 * min, {
      project: 'agentwatch',
      title: 'Write the README',
      snippet: README_DONE,
    }),
    sess('laptop-b', 's5', 'claude', 'working', now - 2 * min, { project: 'payments-core' }),
    sess('laptop-b', 's6', 'claude', 'idle', now - 3 * 3600_000, { project: 'infra' }),
    sess('server', 's7', 'generic', 'idle', now - 50 * min, {
      project: 'nightly-deploy',
      snippet: 'Staging deploy finished. Waiting for the next schedule.',
    }),
    sess('laptop-a', 's8', 'claude', 'ended', now - 5 * 3600_000, { project: 'scratch' }),
  ]
  for (const s of sessions) if (s.id === 's4') s.caps = { reply: true }
  const requests: RequestVM[] = [
    {
      sourceId: 'laptop-a',
      id: 'r2',
      sessionId: 's2',
      kind: 'question',
      createdAt: now - 41 * min,
      status: 'open',
      closedAt: null,
      answerable: true,
      seq: 1,
      info: {
        title: 'Question',
        tool: 'AskUserQuestion',
        questions: [
          {
            question: 'Should the release notes mention the offline-mode beta?',
            header: 'Beta',
            multiSelect: false,
            options: [
              { label: 'Mention it', description: 'One line under “Coming soon”' },
              { label: 'Leave it out', description: 'Ship notes without the beta' },
            ],
          },
        ],
      },
    },
    {
      sourceId: 'laptop-a',
      id: 'r1',
      sessionId: 's1',
      kind: 'permission',
      createdAt: now - 4 * min - 12_000,
      status: 'open',
      closedAt: null,
      answerable: true,
      seq: 2,
      info: {
        title: 'Use Bash',
        tool: 'Bash',
        detail: 'pnpm --filter api-server db:migrate --env local && pnpm --filter api-server test webhooks',
      },
    },
  ]
  if (variant === 'calm') {
    for (const s of sessions) if (s.state === 'needs_you') s.state = 'working'
    return { serverTime: now, skew: 0, mute: null, sources, sessions, requests: [] }
  }
  return { serverTime: now, skew: 0, mute: null, sources, sessions, requests }
}

const README_DONE = `Done. The README now covers the whole path from zero to a paired phone.

## What changed
- **Deploy:** \`agentwatch relay deploy\` creates the Worker and claims it in one step
- **Setup:** per-user install, with the systemd service where it's available
- **Pairing:** QR code, plus the iPhone *Add to Home Screen* flow
- **Security model:** what the relay can and can't see

| Section | Lines |
|:--------|------:|
| Deploy | 64 |
| Troubleshooting | 41 |

Try it locally:

\`\`\`sh
pnpm install && pnpm build
node packages/cli/dist/agentwatch.mjs doctor --test-push
\`\`\`

> The Deploy-to-Cloudflare button is left out until the repo is public.`

export function demoEvents(now = Date.now(), sessionId = 's1'): EventVM[] {
  if (sessionId === 's4') {
    return [
      { at: now - 23 * min, kind: 'done', text: README_DONE },
      {
        at: now - 31 * min,
        kind: 'prompted',
        text: 'Rewrite the README so someone new can deploy, set up and pair a phone without asking me anything.',
      },
      {
        at: now - 52 * min,
        kind: 'done',
        text: 'Read through `docs/` and the CLI help. Two commands were undocumented: `rotate` and `invite`.',
      },
      { at: now - 55 * min, kind: 'prompted', text: 'Start by reading the docs folder and listing what is missing.' },
    ]
  }
  return [
    { at: now - 4 * min, kind: 'needs_you', text: 'pnpm --filter api-server db:migrate --env local' },
    { at: now - 9 * min, kind: 'answered', text: 'Approved from phone' },
    { at: now - 10 * min, kind: 'needs_you', text: 'Edit src/webhooks/billing.ts' },
    {
      at: now - 18 * min,
      kind: 'prompted',
      text: 'Move the billing webhooks onto the job queue and keep retries **idempotent**.',
    },
    {
      at: now - 64 * min,
      kind: 'done',
      text: 'Added the queue consumer and a retry test:\n\n- `src/queue/consumer.ts`: pulls jobs in batches of 25\n- `test/retry.test.ts`: replays a webhook 3 times and expects one charge',
    },
  ]
}

function src(
  id: string,
  user: string,
  host: string,
  privacy: 'full' | 'summary',
  online: boolean,
  lastSeen = Date.now(),
): SourceView {
  return {
    id,
    user,
    host,
    privacy,
    allowMessages: privacy === 'full',
    online,
    lastSeen,
    daemonVersion: '0.1.0',
    adapters: { claude: 'claude 2.1.322' },
  }
}

function sess(
  sourceId: string,
  id: string,
  agent: SessionVM['agent'],
  state: SessionVM['state'],
  since: number,
  info: SessionVM['info'],
): SessionVM {
  return {
    key: `${sourceId}/${id}`,
    sourceId,
    id,
    agent,
    state,
    stateSince: since,
    startedAt: since - 30 * min,
    turnStartedAt: state === 'working' || state === 'needs_you' ? since : null,
    updatedAt: since,
    // What the daemon would say: generic agents never take replies; others can once they are idle.
    caps:
      agent === 'generic'
        ? { reply: false, replyReason: 'This agent can’t take replies' }
        : { reply: false, replyReason: 'You can reply when the agent is idle' },
    info,
  }
}
