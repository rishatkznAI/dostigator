# Isolated iPhone reliability stand

This stand runs the real application, Supabase JS client, repositories, workout RPCs, cardio RPCs, PostgREST and PostgreSQL. It does not connect to production. Auth is an explicit fixture: locally signed JWTs plus a fixture `/auth/v1/user` endpoint. It does **not** verify Supabase Auth, password login, token refresh or physical iOS behavior.

Prerequisites: project dependencies, Node 24, PostgREST 16.5 (`/opt/homebrew/bin/postgrest`).

In separate terminals from repository root:

1. `npx vite --config tests/http-browser/vite.config.mjs`
2. `node tests/http-browser/stand.mjs`
3. `node tests/http-browser/api-cases.mjs`

Open `http://192.168.1.137:4210/__test/login` on this Wi-Fi. The IP in the Vite config is specific to this machine. Owner A is the browser fixture, owner B is the API-test fixture. Every run creates fresh UUIDs. The database is temporary and removed on clean shutdown. Production credentials/data are never loaded.

Test controls are intentionally local-stand-only: `/__test/mode?value=offline|online|missing|lost-response`, `/__test/counts`, `/__test/identities`. They do not ship in the app. `offline` makes the Data API return HTTP 503; it does not change the OS network or `navigator.onLine`. `lost-response` drops the first successful RPC response after the real database commit. Read/write/RLS assertions go through the real API.

For service-worker verification, build with `VITEST=1 VITE_SUPABASE_URL=http://127.0.0.1:4210 VITE_SUPABASE_PUBLISHABLE_KEY=isolated-http-test npm run build`, copy `dist/` to `../iphone-pwa/`, and run `node tests/http-browser/pwa.mjs`. Open `http://127.0.0.1:4213/__test/login`. `/__test/unavailable?value=1` returns HTTP 503 for the static origin; repeat with `value=0` to restore it. With API mode offline, reload the cached app, record a set, reload again, restore the origins and retry synchronization. This checks the real generated service worker on localhost, not iOS standalone mode or airplane mode.

The six anonymous read denials in `api-cases.mjs` have actual authenticated HTTP 200 controls. They do not replace `src/lib/security.remote.test.ts`, whose `/auth/v1/settings` control requires real Supabase Auth. Do not add a fake settings response just to turn that suite green.
