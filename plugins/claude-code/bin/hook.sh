#!/bin/sh
# AgentWatch hook shim. Claude Code runs this for every hook event with the event JSON on stdin.
# It must never get in the agent's way: if AgentWatch isn't installed for this OS user, exit 0 silently.
# `agentwatch setup` writes the launcher this execs, with the absolute path of a Node >= 22.
if [ -n "$AGENTWATCH_HOME" ]; then
  launcher="$AGENTWATCH_HOME/install/hook"
else
  launcher="${XDG_DATA_HOME:-$HOME/.local/share}/agentwatch/hook"
fi
[ -x "$launcher" ] || exit 0
exec "$launcher" "$@"
