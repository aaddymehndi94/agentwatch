// Where AgentWatch keeps things for this OS user. Everything is per-user; nothing needs root.
// AGENTWATCH_HOME overrides all of it (tests, multiple instances).

import os from 'node:os'
import path from 'node:path'

export interface Paths {
  configDir: string
  configFile: string
  stateDir: string
  socket: string
  lockFile: string
  logFile: string
  /** Installed bundle (setup copies dist/ here). */
  installDir: string
}

export function paths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.HOME || os.homedir()
  const root = env.AGENTWATCH_HOME
  const configDir = root ? root : path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'agentwatch')
  const stateDir = root
    ? path.join(root, 'state')
    : path.join(env.XDG_STATE_HOME || path.join(home, '.local/state'), 'agentwatch')
  const installDir = root
    ? path.join(root, 'install')
    : path.join(env.XDG_DATA_HOME || path.join(home, '.local/share'), 'agentwatch')
  return {
    configDir,
    configFile: path.join(configDir, 'config.json'),
    stateDir,
    // Unix socket paths are limited to ~107 bytes; state dirs are short enough in practice.
    socket: path.join(stateDir, 'agentwatchd.sock'),
    lockFile: path.join(stateDir, 'agentwatchd.lock'),
    logFile: path.join(stateDir, 'agentwatchd.log'),
    installDir,
  }
}
