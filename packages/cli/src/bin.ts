// `agentwatch` command line. Kept thin: each command lives in src/commands/.

import { VERSION } from './version.ts'

const HELP = `agentwatch ${VERSION}: a pager for your coding agents

Usage: agentwatch <command> [options]

Getting started
  relay deploy                                  Deploy your relay to Cloudflare (wrangler) and claim it
  setup --relay <url> --claim-secret <secret>   Connect this OS user to a relay you deployed another way
  pair                                          Pair a phone (shows a QR code and link)
  invite                                        Invite another OS user or computer to this relay
  join                                          Join a relay with an invite (pasted on stdin)
  doctor [--test-push]                          Check every link from this user to your phone

Everyday
  status                                        What the daemon sees right now
  mute [30m|1h|8h|until 08:00|off]              Pause notifications to every phone (default 1h)
  setup                                         Re-run any time to update and repair the install

Options for setup, join and relay deploy
  --privacy full|summary    summary: no text (prompts, commands, replies) ever leaves this user
  --no-messages             don't accept free-text replies from the phone (approvals still work)
  --no-claude               don't install the Claude Code plugin
  --node <path>             Node (22+) for the hook launchers; picked automatically otherwise

Daemon
  daemon [--foreground]                         Run the daemon (normally started on demand by hooks)
  stop                                          Stop this user's daemon
  uninstall [--purge]                           Remove AgentWatch for this user (--purge: config and key too)

Internal
  hook <agent>                                  Hook client agents call (reads the event on stdin)`

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv
  switch (cmd) {
    case undefined:
    case 'help':
    case '-h':
    case '--help':
      console.log(HELP)
      return 0
    case '-v':
    case '--version':
    case 'version':
      console.log(VERSION)
      return 0
    case 'daemon': {
      const { runDaemon } = await import('./daemon/main.ts')
      return runDaemon(rest.includes('--foreground') || rest.includes('-f'))
    }
    case 'hook':
      process.argv = [process.argv[0]!, process.argv[1]!, ...rest]
      await import('./hook-entry.ts')
      return await new Promise<number>(() => {})
    case 'setup':
      return (await import('./commands/setup.ts')).setup(rest)
    case 'pair':
      return (await import('./commands/pair.ts')).pair(rest)
    case 'status':
      return (await import('./commands/status.ts')).status(rest)
    case 'stop':
      return (await import('./commands/status.ts')).stop()
    case 'join':
      return (await import('./commands/join.ts')).join(rest)
    case 'invite':
      return (await import('./commands/invite.ts')).invite(rest)
    case 'uninstall':
      return (await import('./commands/uninstall.ts')).uninstall(rest)
    case 'relay':
      return (await import('./commands/relay.ts')).relay(rest)
    case 'doctor':
      return (await import('./commands/doctor.ts')).doctor(rest)
    case 'mute':
      return (await import('./commands/mute.ts')).mute(rest)
    case 'unmute':
      return (await import('./commands/mute.ts')).mute(['off'])
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`)
      return 64
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(`agentwatch: ${e instanceof Error ? e.message : String(e)}`)
    process.exit(1)
  },
)
