// `agentwatch` command line. Kept thin: each command lives in src/commands/.

import { VERSION } from './version.ts'

const HELP = `agentwatch ${VERSION} — a pager for your coding agents

Usage: agentwatch <command> [options]

Getting started
  setup --relay <url> --claim-secret <secret>   Connect this OS user to your relay (first machine)
  pair                                          Pair a phone (shows a QR code and link)
  status                                        What the daemon sees right now

Daemon
  daemon [--foreground]                         Run the daemon (normally started on demand by hooks)
  stop                                          Stop this user's daemon

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
