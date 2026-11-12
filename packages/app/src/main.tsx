import { render } from 'preact'
import { App } from './app.tsx'
import { boot } from './lib/store.ts'
import '@fontsource-variable/geist/wght.css'
import '@fontsource-variable/geist/wght-italic.css'
import '@fontsource-variable/geist-mono/wght.css'
import './styles.css'

void boot()
render(<App />, document.getElementById('root')!)

if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('demo')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}
