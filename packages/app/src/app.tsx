// Hash router and the one-second clock that drives ticket timers.

import type { ComponentChildren } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { type AppState, useApp } from './lib/store.ts'
import { Inbox } from './screens/inbox.tsx'
import { JoinOnPhone, PairScreen } from './screens/pair.tsx'
import { SessionScreen } from './screens/session.tsx'
import { SettingsScreen } from './screens/settings.tsx'

function useHash(): string {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  return hash
}

function useNow(): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }, 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

const go = (hash: string) => {
  if (location.hash !== hash) location.hash = hash
  scrollTo(0, 0)
}

/** The sky at the top of every screen: cool when nothing waits on you, warm when something does. */
function mood(app: AppState): 'calm' | 'waiting' | 'offline' | 'setup' {
  if (!app.model) return app.error ? 'offline' : 'calm'
  if (app.error) return 'offline'
  if (app.model.requests.some((r) => r.status === 'open')) return 'waiting'
  return 'calm'
}

function Shell({ app, children, view }: { app: AppState | null; children: ComponentChildren; view: string }) {
  return (
    <main class="app" data-mood={app ? mood(app) : 'setup'}>
      <div class="sky" aria-hidden="true" />
      <div class="view" key={view}>
        {children}
      </div>
    </main>
  )
}

export function App() {
  const app = useApp()
  const hash = useHash()
  const now = useNow()
  if (!app.booted) return null

  if (hash.startsWith('#/join/')) {
    return (
      <Shell app={null} view="join">
        <JoinOnPhone />
      </Shell>
    )
  }
  const pair = /^#\/pair(?:\/(.+))?$/.exec(hash)
  if (pair || (!app.creds && !app.demo) || app.revoked) {
    return (
      <Shell app={null} view="pair">
        {app.revoked && (
          <div class="banner bad" role="alert">
            <p>This phone was unpaired from your relay. Pair it again to continue.</p>
          </div>
        )}
        <PairScreen app={app} code={pair?.[1] ? decodeURIComponent(pair[1]) : undefined} go={go} />
      </Shell>
    )
  }
  const session = /^#\/s\/([^/]+)\/([^/]+)$/.exec(hash)
  return (
    <Shell app={app} view={session ? hash : hash === '#/settings' ? 'settings' : 'inbox'}>
      {session ? (
        <SessionScreen
          app={app}
          now={now}
          sourceId={decodeURIComponent(session[1]!)}
          sessionId={decodeURIComponent(session[2]!)}
          go={go}
        />
      ) : hash === '#/settings' ? (
        <SettingsScreen app={app} now={now} go={go} />
      ) : (
        <Inbox app={app} now={now} go={go} />
      )}
    </Shell>
  )
}
