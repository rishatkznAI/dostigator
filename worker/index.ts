interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
}

export default {
  async fetch(request: Request, env: Env) {
    let response = await env.ASSETS.fetch(request)
    const navigation = request.method === 'GET' && request.headers.get('accept')?.includes('text/html')
    if (response.status === 404 && navigation) {
      response = await env.ASSETS.fetch(new Request(new URL('/index.html', request.url), request))
    }
    if (navigation || new URL(request.url).pathname === '/sw.js') {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'no-cache')
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    }
    return response
  },
}
