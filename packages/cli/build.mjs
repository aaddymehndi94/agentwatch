// Bundle the CLI into two self-contained ESM files:
//   dist/agentwatch.mjs — everything (daemon, commands)
//   dist/hook.mjs       — the tiny hook client agents run on every event (node builtins only, fast startup)

import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
// The Claude Code plugin ships inside the bundle, so `agentwatch setup` can install the exact matching version.
const plugin = new URL('./dist/plugin/', import.meta.url)
rmSync(plugin, { recursive: true, force: true })
cpSync(new URL('../../plugins/claude-code/', import.meta.url), plugin, {
  recursive: true,
  filter: (src) => !/[/\\](types|tsconfig\.json|node_modules)$/.test(src) || src.endsWith('claude-code'),
})
const manifest = new URL('./.claude-plugin/plugin.json', plugin)
writeFileSync(manifest, `${JSON.stringify({ ...JSON.parse(readFileSync(manifest, 'utf8')), version }, null, 2)}\n`)
console.log(`built agentwatch ${version}`)
