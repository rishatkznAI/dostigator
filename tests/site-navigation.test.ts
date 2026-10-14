import { describe, expect, it, vi } from 'vitest'
import worker from '../worker/index'

describe('published SPA navigation', () => {
  it('serves the app shell for a direct training link when the asset host returns 404', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('missing', { status: 404 })).mockResolvedValueOnce(new Response('<html>app</html>'))
    const response = await worker.fetch(new Request('https://example.com/training/cardio', { headers: { Accept: 'text/html' } }), { ASSETS: { fetch } })
    expect(fetch.mock.calls[1]![0].url).toBe('https://example.com/index.html')
    expect(await response.text()).toBe('<html>app</html>')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
  })
  it('keeps missing assets as 404 and checks service worker updates without caching', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }))
    expect((await worker.fetch(new Request('https://example.com/missing.js'), { ASSETS: { fetch } })).status).toBe(404)
    expect(fetch).toHaveBeenCalledOnce()
    const sw = await worker.fetch(new Request('https://example.com/sw.js'), { ASSETS: { fetch } })
    expect(sw.headers.get('Cache-Control')).toBe('no-cache')
  })
})
