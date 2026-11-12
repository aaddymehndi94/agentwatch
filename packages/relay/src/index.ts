// AgentWatch relay Worker. Static app assets are served by Workers Static Assets; every /api/* request goes to the
// single Hub Durable Object, which owns all state and the sources' WebSockets.

import { CLAIM_SECRET_HEADER } from './hub.ts'

export { Hub } from './hub.ts'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const headers = new Headers(request.headers)
      // Only the Worker may say what the claim secret is; never a client.
      headers.delete(CLAIM_SECRET_HEADER)
      // A running Durable Object keeps the env it started with, so right after `wrangler secret put` it may not see
      // the new CLAIM_SECRET yet. The Worker always runs the newest version, so it hands the secret over.
      if (url.pathname === '/api/claim' && env.CLAIM_SECRET) headers.set(CLAIM_SECRET_HEADER, env.CLAIM_SECRET)
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(new Request(request, { headers }))
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
