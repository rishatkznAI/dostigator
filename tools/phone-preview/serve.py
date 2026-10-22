# coding: utf-8
"""Private Wi-Fi fixture preview. Never a production or cloud server."""
import argparse
import hmac
import http.cookies
import http.server
import ipaddress
import json
import mimetypes
from pathlib import Path
import secrets
import threading
import time
from urllib.parse import unquote, urlsplit


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True)
    parser.add_argument('--port', type=int, default=4194)
    parser.add_argument('--network', required=True)
    parser.add_argument('--hours', type=float, default=12)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    content = root / 'dist'
    network = ipaddress.ip_network(args.network, strict=False)
    if not ipaddress.ip_address(args.host).is_private or ipaddress.ip_address(args.host) not in network:
        raise SystemExit('Bind address must be private and inside the Wi-Fi subnet')
    if not (content / 'index.html').is_file():
        raise SystemExit('Build the fixture preview first')
    token = secrets.token_urlsafe(24)
    expires = time.time() + args.hours * 3600
    state = {'url': f'http://{args.host}:{args.port}/open/{token}', 'origin': f'http://{args.host}:{args.port}',
             'bind': args.host, 'port': args.port, 'network': str(network), 'expiresUnix': expires,
             'fixtureOnly': True, 'cloud': False}
    state_file = root / 'session.json'
    state_file.write_text(json.dumps(state, indent=2), encoding='utf-8')
    state_file.chmod(0o600)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *unused):
            pass  # Do not log the one-time entry URL or cookies.

        def respond(self, status, body=b'', content_type='text/plain; charset=utf-8', extra=None):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
            for key, value in (extra or {}).items():
                self.send_header(key, value)
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            if ipaddress.ip_address(self.client_address[0]) not in network or self.headers.get('Host') != f'{args.host}:{args.port}':
                return self.respond(403, b'Wi-Fi preview only')
            if time.time() >= expires:
                return self.respond(410, b'Preview session expired')
            path = unquote(urlsplit(self.path).path)
            if hmac.compare_digest(path.encode('utf-8'), f'/open/{token}'.encode('utf-8')):
                return self.respond(303, extra={'Location': '/training', 'Set-Cookie': f'dostigator_preview={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={int(args.hours*3600)}'})
            cookie = http.cookies.SimpleCookie()
            try:
                cookie.load(self.headers.get('Cookie', ''))
                supplied = cookie['dostigator_preview'].value if 'dostigator_preview' in cookie else ''
            except http.cookies.CookieError:
                supplied = ''
            if not hmac.compare_digest(supplied, token):
                return self.respond(403, 'Откройте полную ссылку приёмки на этом устройстве.'.encode('utf-8'))
            file = (content / path.lstrip('/')).resolve()
            if not file.is_relative_to(content.resolve()) or any(part.startswith('.') for part in Path(path).parts):
                return self.respond(404)
            if not file.is_file():
                if path == '/' or (path.startswith('/training') and '.' not in path):
                    file = content / 'index.html'
                else:
                    return self.respond(404)
            return self.respond(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] or 'application/octet-stream')

    server = http.server.ThreadingHTTPServer((args.host, args.port), Handler)
    timer = threading.Timer(args.hours * 3600, server.shutdown)
    timer.daemon = True
    timer.start()
    print(json.dumps(state), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        timer.cancel()
        server.server_close()


if __name__ == '__main__':
    main()
