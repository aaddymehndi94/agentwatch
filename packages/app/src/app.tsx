// Hash router and the one-second clock that drives ticket timers.

import { useEffect, useState } from 'preact/hooks'
import { useApp } from './lib/store.ts'
import { Inbox } from './screens/inbox.tsx'
import { PairScreen } from './screens/pair.tsx'
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

export function App() {
  const app = useApp()
  const hash = useHash()
  const now = useNow()
  if (!app.booted) return null

  const pair = /^#\/pair(?:\/(.+))?$/.exec(hash)
  if (pair || (!app.creds && !app.demo) || app.revoked) {
    return (
      <main class="app">
        {app.revoked && (
          <div class="banner" role="alert">
            <p>This phone was unpaired from your relay. Pair it again to continue.</p>
          </div>
        )}
        <PairScreen app={app} code={pair?.[1] ? decodeURIComponent(pair[1]) : undefined} go={go} />
      </main>
    )
  }
  const session = /^#\/s\/([^/]+)\/([^/]+)$/.exec(hash)
  return (
    <main class="app">
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
    </main>
  )
}
