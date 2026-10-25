import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { prepareFreshEntry } from '../scripts/prepare-pages-build.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const loadConfig = `
  import { loadConfigFromFile } from 'vite';
  const result = await loadConfigFromFile({ command: 'build', mode: 'production' });
  const config = result.config;
  const info = JSON.parse(config.define.__DOSTIGATOR_BUILD__);
  const emitted = [];
  const plugin = config.plugins.find(item => item?.name === 'dostigator-build-info');
  plugin.generateBundle.call({ emitFile: file => emitted.push(file) });
  console.log('RELEASE_CONFIG=' + JSON.stringify({ base: config.base, info, emitted }));
`
const run = (env) => spawnSync(process.execPath, ['--input-type=module', '-e', loadConfig], {
  cwd: root,
  env: { ...process.env, VITEST: '1', GITHUB_PAGES: 'true', GITHUB_SHA: '', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '', ...env },
  encoding: 'utf8',
})
const read = (result) => {
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout.split('\n').find(line => line.startsWith('RELEASE_CONFIG=')).slice('RELEASE_CONFIG='.length))
}

test('Pages cannot publish an unconfigured client', () => {
  const missingBoth = run({})
  assert.notEqual(missingBoth.status, 0)
  assert.match(missingBoth.stderr, /GitHub Pages build requires VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY/)
  const missingKey = run({ VITE_SUPABASE_URL: 'https://release-fixture.supabase.co' })
  assert.notEqual(missingKey.status, 0)
  assert.match(missingKey.stderr, /GitHub Pages build requires VITE_SUPABASE_PUBLISHABLE_KEY/)
})

test('the bundled identity and public artifact match without configuration secrets', () => {
  const commit = '0123456789abcdef0123456789abcdef01234567'
  const { base, info, emitted } = read(run({
    GITHUB_SHA: commit,
    VITE_SUPABASE_URL: 'https://release-fixture.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_release_fixture',
  }))
  assert.equal(base, '/dostigator/')
  assert.equal(info.commit, commit)
  assert.equal(info.version, '0.1.1')
  assert.equal(new Date(info.builtAt).toISOString(), info.builtAt)
  assert.deepEqual(Object.keys(info).sort(), ['builtAt', 'commit', 'version'])
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].fileName, 'build-info.json')
  assert.deepEqual(JSON.parse(emitted[0].source), info)
  assert.doesNotMatch(emitted[0].source, /release-fixture|sb_publishable|SUPABASE/)
})

test('standalone local builds have an explicit local identity and root base', () => {
  const { base, info } = read(run({ GITHUB_PAGES: 'false' }))
  assert.equal(base, '/')
  assert.equal(info.commit, 'local')
})

test('network entry uses the finished hashed app shell without altering it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dostigator-fresh-entry-'))
  try {
    const html = '<html><head><script type="module" src="/dostigator/assets/index-release.js"></script></head><body><div id="root"></div></body></html>'
    await writeFile(join(directory, 'index.html'), html)
    await prepareFreshEntry(directory)
    assert.equal(await readFile(join(directory, 'auth/v1/open.html'), 'utf8'), html)
    assert.equal(await readFile(join(directory, 'index.html'), 'utf8'), html)
    await mkdir(join(directory, 'unrelated'), { recursive: true })
    await writeFile(join(directory, 'unrelated/sentinel'), 'preserved')
    await prepareFreshEntry(directory)
    assert.equal(await readFile(join(directory, 'unrelated/sentinel'), 'utf8'), 'preserved')
  } finally { await rm(directory, { recursive: true, force: true }) }
})
