// Bundle the CLI into two self-contained ESM files:
//   dist/agentwatch.mjs — everything (daemon, commands)
//   dist/hook.mjs       — the tiny hook client agents run on every event (node builtins only, fast startup)

import { readFileSync } from 'node:fs'
import { build } from 'esbuild'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const common = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  define: { __AGENTWATCH_VERSION__: JSON.stringify(version) },
  // ws optionally requires these native addons inside try/catch.
  external: ['bufferutil', 'utf-8-validate'],
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
}
await build({ ...common, entryPoints: ['src/bin.ts'], outfile: 'dist/agentwatch.mjs' })
await build({ ...common, entryPoints: ['src/hook-entry.ts'], outfile: 'dist/hook.mjs' })
console.log(`built agentwatch ${version}`)
