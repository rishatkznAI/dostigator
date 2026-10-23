# Isolated iPhone reliability stand

This stand runs the real application, Supabase JS client, repositories, workout RPCs, cardio RPCs, PostgREST and PostgreSQL. It does not connect to production. Auth is an explicit fixture: locally signed JWTs plus a fixture `/auth/v1/user` endpoint. It does **not** verify Supabase Auth, password login, token refresh or physical iOS behavior.

Prerequisites: project dependencies, Node 24, PostgREST 16.5 (`/opt/homebrew/bin/postgrest`).

In separate terminals from repository root:

1. `npx vite --config tests/http-browser/vite.config.mjs`
2. `node tests/http-browser/stand.mjs`
3. `node tests/http-browser/api-cases.mjs`

Open `http://127.0.0.1:4210/__test/login` on this machine. See the optional LAN configuration below. Owner A is the browser fixture, owner B is the API-test fixture. Every run creates fresh UUIDs. The database is temporary and removed on clean shutdown. Production credentials/data are never loaded.

Test controls are intentionally local-stand-only: `/__test/mode?value=offline|online|missing|lost-response`, `/__test/counts`, `/__test/identities`. They do not ship in the app. `offline` makes the Data API return HTTP 503; it does not change the OS network or `navigator.onLine`. `lost-response` drops the first successful RPC response after the real database commit. Read/write/RLS assertions go through the real API.

For service-worker verification, build with `VITE_SUPABASE_URL=http://127.0.0.1:4210 VITE_SUPABASE_PUBLISHABLE_KEY=isolated-http-test npm run build`, copy the contents of `dist/client/` to `../iphone-pwa/`, and run `node tests/http-browser/pwa.mjs`. Open `http://127.0.0.1:4213/__test/login`. `/__test/unavailable?value=1` returns HTTP 503 for the static origin; repeat with `value=0` to restore it. With API mode offline, reload the cached app, record a set, reload again, restore the origins and retry synchronization. This checks the real generated service worker on localhost, not iOS standalone mode or airplane mode.

The six anonymous read denials in `api-cases.mjs` have actual authenticated HTTP 200 controls. They do not replace `src/lib/security.remote.test.ts`, whose `/auth/v1/settings` control requires real Supabase Auth. Do not add a fake settings response just to turn that suite green.

## Repeatable product audit (23 October 2026)

The default stand is now loopback-only at `http://127.0.0.1:4210`; `postgrest` must be on PATH or specified with `POSTGREST_BIN`.
For a deliberately shared LAN stand, set `DOSTIGATOR_TEST_ORIGIN` consistently for Vite and stand, and `DOSTIGATOR_TEST_BIND=0.0.0.0` for stand. Test auth storage follows the configured hostname. Never use production keys or production data.

Install browser engines with `pnpm exec playwright install chromium webkit`. Run the existing Vite and stand terminals, then run these **sequentially**, because fault injection changes the shared stand's API mode:

```sh
pnpm test:browser:product
pnpm test:browser:secondary
node tests/http-browser/api-cases.mjs
```

`DOSTIGATOR_AUDIT_OUTPUT` selects the output directory. `PLAYWRIGHT_EXECUTABLE_PATH` optionally selects an existing Chromium binary. The product suite performs full A/B/C flows, rest, optional RIR, correction, exact cardio, cancellation, outages and 17 routes at 375/390/430/768/1280 pixels. The secondary suite covers goals, actions, habits, journal, reviews, measurements, nutrition and exercise tools.

For the production PWA (without Vite HMR), build normally with only the isolated URL and publishable key in the environment, copy `dist/client/` to `../iphone-pwa/`, and run `node tests/http-browser/pwa.mjs`. Then:

```sh
DOSTIGATOR_BROWSER=webkit DOSTIGATOR_TEST_ORIGIN=http://127.0.0.1:4213 DOSTIGATOR_API_ORIGIN=http://127.0.0.1:4210 pnpm test:browser:product
node tests/browser/pwa-audit.mjs
DOSTIGATOR_TEST_ORIGIN=http://127.0.0.1:4213 node tests/browser/dialog-visual-audit.mjs
```

The PWA suite verifies real generated service-worker responses, static HTTP 503, API HTTP 503, browser offline, reload, reconnect and exact persisted fact cardinality. WebKit is browser-engine coverage, not physical iPhone Safari/PWA/keyboard certification.

The independent hosted Auth test requires an ignored `.env.audit.local` with the existing isolated project settings and disposable account password. `pnpm test:browser:auth` refuses production and verifies password login, failed login, logout, account isolation, re-login and correction replay after a committed response is deliberately dropped. It never sends magic-link/recovery emails or changes production.

The final dialog visual gate checks technique, exercise list, finish and correction sheets in Chromium/WebKit at all five widths. It asserts that the visible handle is inside and centered in its dialog, that the document does not overflow, and that the optional RIR select has a mobile touch target. Screenshots finish CSS animations before capture. Run it after the latest isolated PWA build.
