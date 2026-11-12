import { readFileSync } from 'node:fs'
import preact from '@preact/preset-vite'
import { build as esbuild } from 'esbuild'
import { defineConfig, type Plugin } from 'vite'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** The service worker is a classic script at /sw.js (widest support), bundled by esbuild after the app build. */
function serviceWorker(): Plugin {
  return {
    name: 'agentwatch-sw',
    apply: 'build',
    async closeBundle() {
      await esbuild({
        entryPoints: ['src/sw.ts'],
        outfile: 'dist/sw.js',
        bundle: true,
        format: 'iife',
        target: 'es2022',
        minify: true,
        legalComments: 'none',
      })
    },
  }
}

export default defineConfig({
  plugins: [preact(), serviceWorker()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
})
