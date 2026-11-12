// Replaced at bundle time by esbuild; falls back for tests that run the sources directly.
declare const __AGENTWATCH_VERSION__: string | undefined
export const VERSION: string = typeof __AGENTWATCH_VERSION__ === 'string' ? __AGENTWATCH_VERSION__ : '0.0.0-dev'
