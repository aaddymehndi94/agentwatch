import { render } from 'preact'
import { App } from './app.tsx'
import { boot } from './lib/store.ts'
import './styles.css'

void boot()
render(<App />, document.getElementById('root')!)

if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('demo')) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  })
}
