// AgentWatch relay Worker. Static app assets are served by Workers Static Assets; every /api/* request goes to the
// single Hub Durable Object, which owns all state and the sources' WebSockets.

export { Hub } from './hub.ts'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(request)
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
