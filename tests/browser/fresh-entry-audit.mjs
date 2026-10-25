import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { chromium } from 'playwright'

// Real legacy autoUpdate worker + legacy client in two tabs. The candidate's
// network HTML alias must upgrade one page without activating a waiting worker,
// touching storage, or reloading the other legacy page's unsaved form.
const oldBuild = resolve(process.env.PWA_OLD_BUILD ?? '../pwa-update-build-old')
const newBuild = resolve(process.env.PWA_NEW_BUILD ?? '../fresh-entry-build-new')
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/fresh-entry-audit')
await mkdir(out, { recursive: true })
const expectedBuild = JSON.parse(await readFile(resolve(newBuild, 'build-info.json'), 'utf8'))
assert.equal(expectedBuild.version, '0.1.1', 'fresh candidate must identify its release version')
assert.ok(/self\.skipWaiting\(\)/.test(await readFile(resolve(oldBuild, 'sw.js'), 'utf8')), 'baseline must use the real legacy worker')
const freshHtml = await readFile(resolve(newBuild, 'auth/v1/open.html'), 'utf8')
assert.equal(freshHtml, await readFile(resolve(newBuild, 'index.html'), 'utf8'), 'network alias must be the actual candidate index')
const worker = await readFile(resolve(newBuild, 'sw.js'), 'utf8')
assert.ok(!worker.includes('url:"auth/v1/open.html"') && !worker.includes('url: \'auth/v1/open.html\''), 'HTML alias must not be precached')
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
let build = oldBuild
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/dostigator\//, '')
    if (path.includes('..')) { response.writeHead(400).end(); return }
    let file = resolve(build, path || 'index.html')
    if (!extname(file)) file = resolve(build, 'index.html')
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const result = { checks: [], errors: [], failures: [], expectedBuild }
const check = name => { result.checks.push(name); console.log('PASS ' + name) }
const openLegacy = async () => {
  const page = await context.newPage()
  page.on('pageerror', error => result.errors.push(error.message))
  await page.goto(origin + '/dostigator/login')
  await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  return page
}
let first, second
try {
  first = await context.newPage()
  first.on('pageerror', error => result.errors.push(error.message))
  await first.goto(origin + '/dostigator/login')
  await first.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  await first.evaluate(() => navigator.serviceWorker.ready)
  await first.reload()
  await first.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  second = await openLegacy()
  assert.ok(!(await first.locator('body').innerText()).includes('0.1.1'))
  assert.ok(!(await second.locator('body').innerText()).includes('0.1.1'))
  await first.getByRole('textbox', { name: 'Email', exact: true }).fill('first-draft@example.test')
  await second.getByRole('textbox', { name: 'Email', exact: true }).fill('second-unsent@example.test')
  const fixtureOwner = crypto.randomUUID(), fixtureSession = crypto.randomUUID(), stamp = '2026-10-25T12:00:00.000Z'
  const program = JSON.parse(await readFile('src/lib/program-v21.json', 'utf8')).find(item => item.code === 'A')
  const draft = {
    schemaVersion: 3, programRevision: 'V2.1', id: fixtureSession, userId: fixtureOwner,
    templateCode: 'A', title: 'Тестовая тренировка A', startedAt: stamp, finishedAt: null,
    timerPausedAt: null, timerPausedDurationMs: 0, readiness: null, activeRest: null,
    deletedSetIds: [], updatedAt: stamp, syncState: 'pending',
    exercises: program.items.map(item => ({ id: crypto.randomUUID(), exercise: item.exercise,
      target: item.repTarget, sortOrder: item.sortOrder, skipped: false, skipReason: '',
      sets: [{ id: crypto.randomUUID(), setNumber: 1, weightKg: 37.5, reps: 9, rir: null,
        done: true, isWarmup: false, completedAt: stamp }] })),
  }
  const sentinels = {
    'release-test:sentinel': 'preserve-exactly-ё-♥',
    [`trainlog:active:${fixtureOwner}`]: JSON.stringify(draft),
    [`trainlog:queue:${fixtureOwner}`]: JSON.stringify([draft]),
    [`trainlog:workout-conflicts:${fixtureOwner}`]: JSON.stringify([{ id: fixtureSession, local: draft, remote: null }]),
  }
  await first.evaluate(values => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value) }, sentinels)
  const idbSentinel = JSON.stringify({ note: 'preserve-indexeddb-ё-♥', weightKg: 37.5 })
  await first.evaluate(value => new Promise((done, reject) => {
    const request = indexedDB.open('release-test-storage', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('sentinels')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result, tx = db.transaction('sentinels', 'readwrite'); tx.objectStore('sentinels').put(value, 'draft'); tx.onerror = () => reject(tx.error); tx.oncomplete = () => { db.close(); done() } }
  }), idbSentinel)
  const readIdb = page => page.evaluate(() => new Promise((done, reject) => {
    const request = indexedDB.open('release-test-storage', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => { const db = request.result; if (!db.objectStoreNames.contains('sentinels')) { db.close(); done(null); return }; const get = db.transaction('sentinels').objectStore('sentinels').get('draft'); get.onerror = () => reject(get.error); get.onsuccess = () => { db.close(); done(get.result) } }
  }))
  const readSentinels = page => page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(sentinels))
  await first.evaluate(() => { window.__testControllerChanges = 0; navigator.serviceWorker.addEventListener('controllerchange', () => window.__testControllerChanges++) })
  await second.evaluate(() => { window.__testControllerChanges = 0; navigator.serviceWorker.addEventListener('controllerchange', () => window.__testControllerChanges++) })
  let firstNavigations = 0, secondNavigations = 0
  first.on('framenavigated', frame => { if (frame === first.mainFrame()) firstNavigations++ })
  second.on('framenavigated', frame => { if (frame === second.mainFrame()) secondNavigations++ })
  build = newBuild
  await first.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update() })
  await first.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))
  await first.waitForTimeout(500)
  assert.equal(firstNavigations, 0); assert.equal(secondNavigations, 0)
  assert.equal(await first.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'first-draft@example.test')
  assert.equal(await second.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'second-unsent@example.test')
  check('candidate worker waits without activating or reloading either legacy unsaved form')

  // The user must save visible inputs before deliberately navigating. Model that
  // instruction with a local test-only saved value, not a real Auth request.
  await first.evaluate(() => localStorage.setItem('release-test:saved-form', document.querySelector('input[type="email"]').value))
  const regular = await first.reload()
  await first.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  assert.equal(regular.fromServiceWorker(), true)
  assert.ok(!(await first.locator('body').innerText()).includes('0.1.1'))
  assert.equal(await first.evaluate(() => localStorage.getItem('release-test:saved-form')), 'first-draft@example.test')
  assert.ok(await first.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)))
  check('ordinary reload remains on the legacy cached shell while its worker has another open client')
  await first.screenshot({ path: resolve(out, '390-normal-reload-still-legacy.png'), fullPage: true })

  const fresh = await first.goto(origin + '/dostigator/auth/v1/open.html')
  assert.equal(fresh.fromServiceWorker(), false, 'fresh HTML must come from the network')
  assert.equal(fresh.status(), 200)
  await first.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  await first.getByText(/0\.1\.1/).first().waitFor()
  const visibleText = await first.locator('body').innerText()
  const expectedMarker = expectedBuild.commit === 'local' ? 'локальная' : expectedBuild.commit.slice(0, 7)
  assert.ok(visibleText.includes(expectedMarker), 'visible release marker must identify the candidate build')
  assert.equal(await first.getByRole('button', { name: 'Обновить приложение', exact: true }).count(), 0, 'bridge must not offer activation while another legacy tab is open')
  assert.ok(await first.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'new UI can run while old worker still controls the page')
  assert.ok(await first.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)), 'fresh entry must not activate the waiting worker')
  check('network-only entry loads the visible 0.1.1 candidate while the old worker remains active')
  await first.screenshot({ path: resolve(out, '390-fresh-entry-current-version.png'), fullPage: true })

  await second.waitForTimeout(1200)
  assert.equal(secondNavigations, 0)
  assert.equal(await second.evaluate(() => window.__testControllerChanges), 0)
  assert.equal(await second.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'second-unsent@example.test')
  check('the second legacy tab keeps its unsent input with zero navigation or controller changes')
  await second.screenshot({ path: resolve(out, '390-second-legacy-unsent-preserved.png'), fullPage: true })
  assert.deepEqual(await readSentinels(first), sentinels)
  assert.deepEqual(await readSentinels(second), sentinels)
  assert.equal(await readIdb(first), idbSentinel); assert.equal(await readIdb(second), idbSentinel)
  check('localStorage and IndexedDB sentinels, active workout, queue and conflict JSON are byte-for-byte unchanged')
  assert.deepEqual(result.errors, [])
  check('fresh entry produces no uncaught JavaScript errors')
} catch (error) {
  result.failures.push({ message: error.message, stack: error.stack }); process.exitCode = 1
  await first?.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  await browser.close(); await new Promise(done => server.close(done))
}
