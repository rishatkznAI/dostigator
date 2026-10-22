// Read-only Supabase API acceptance, restricted to an isolated loopback stack.
import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const tables = ['dostigator_areas', 'dostigator_goals', 'dostigator_actions', 'dostigator_habits', 'dostigator_habit_checkins', 'dostigator_weekly_reviews']
try {
  const input = process.env.ISOLATED_SUPABASE_URL
  assert(input, 'Missing isolated URL; no requests sent')
  const url = new URL(input)
  assert(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    && url.port && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash,
  'Only explicit loopback HTTP origin with a port is accepted; no requests sent')
  const anon = process.env.ISOLATED_ANON_JWT
  const owner = process.env.ISOLATED_OWNER_JWT
  assert(anon && owner && process.env.DOSTIGATOR_TEST_CHECKOUT, 'Missing local anon JWT, fixture owner JWT or checkout; no requests sent')
  const claims = token => {
    assert(token.split('.').length === 3, 'This unchanged suite requires a legacy anon JWT and owner access JWT')
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  }
  assert(claims(anon).role === 'anon', 'Anonymous tests must not use service-role/secret/owner keys')
  assert(claims(owner).role === 'authenticated' && claims(owner).sub, 'Positive control needs a fixture owner access JWT')
  const checkout = await realpath(process.env.DOSTIGATOR_TEST_CHECKOUT)
  const original = await readFile(join(checkout, 'src/lib/security.remote.test.ts'), 'utf8')
  assert(original.includes('remote anonymous boundary') && tables.every(table => original.includes(`'${table}'`)), 'Unexpected test suite')
  const get = async (path, jwt) => fetch(new URL(path, url), {
    headers: { apikey: anon, Authorization: `Bearer ${jwt}` },
    signal: AbortSignal.timeout(10000), redirect: 'error',
  })
  const settings = await get('/auth/v1/settings', anon)
  assert.equal(settings.status, 200, 'Gateway/key positive control failed; anonymous 401 would be inconclusive')
  for (const table of tables) {
    const response = await get(`/rest/v1/${table}?select=id&limit=1`, owner)
    assert.equal(response.status, 200, `Fixture owner read control failed: ${table}`)
    const rows = await response.json()
    assert(Array.isArray(rows) && rows.length > 0, `Seed an owned fixture before negative tests: ${table}`)
    console.log(`Positive control passed: ${table}`)
  }
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'src/lib/security.remote.test.ts'], {
    cwd: checkout, stdio: 'inherit', timeout: 120000,
    env: { ...process.env, VITE_SUPABASE_URL: url.origin, VITE_SUPABASE_PUBLISHABLE_KEY: anon },
  })
  assert.equal(result.status, 0, 'Six-test suite did not finish successfully; review its output')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
