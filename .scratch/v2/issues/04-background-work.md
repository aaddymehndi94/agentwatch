# 04: An agent waiting on its own background work isn't idle

**What to build:** Claude now runs subagents (and background shells, monitors, workflows) in the background by
default. Its turn ends while they run, so AgentWatch showed the session as idle and pushed "done" too early. `Stop`
lists the in-flight work (`background_tasks`); while that list isn't empty the session stays working, its timer keeps
running, the phone says what it waits on, and "done" pushes only when everything has finished.

Reported by the owner on 2026-11-13: "agents look idle but are idle only because they are waiting for their subagents".

**Decision:** only subagents and workflows hold a turn open. They always come back and report. A background shell
or monitor (a dev server, a log watcher) can run for hours, and the turn really is over, so those still push "done".

**Status:** done

- [x] Protocol: `turn.end.background`, `Session.background`, transition `waiting` (no push), turn timer kept
- [x] Claude adapter reads `background_tasks` from `Stop` (running subagents and workflows only)
- [x] App: inbox row ("Waiting · 2 background agents"), session screen (what it waits on, with the timer), timeline
- [x] Tests: state machine, adapter (incl. a dev server that must not hold the turn), app model
