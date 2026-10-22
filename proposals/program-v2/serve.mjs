import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
const files = { '/': ['index.html','text/html; charset=utf-8'], '/index.html': ['index.html','text/html; charset=utf-8'], '/style.css': ['style.css','text/css; charset=utf-8'], '/app.mjs': ['app.mjs','text/javascript; charset=utf-8'], '/model.mjs': ['model.mjs','text/javascript; charset=utf-8'], '/local-integration.mjs': ['local-integration.mjs','text/javascript; charset=utf-8'], '/program.json': ['program.json','application/json; charset=utf-8'], '/report.txt': ['report.txt','text/plain; charset=utf-8'] }
const server = createServer(async (request, response) => {
 if (!['GET','HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return }
 const route = files[new URL(request.url, 'http://localhost').pathname]
 if (!route) { response.writeHead(404); response.end(); return }
 try { const data = await readFile(new URL(route[0], import.meta.url)); response.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'" }); response.end(request.method === 'HEAD' ? undefined : data) } catch { response.writeHead(500); response.end('Local file unavailable') }
})
server.listen(4189,'127.0.0.1', () => console.log('Local: http://127.0.0.1:4189/ — v2 proposal, no cloud connection'))
