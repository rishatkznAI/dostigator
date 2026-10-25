import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { chromium } from 'playwright'

// Three independent builds: real legacy runtime, candidate, and a next-release
// fixture with distinct bundled metadata. Never switch shared API fault modes.
const oldBuild = resolve(process.env.PWA_OLD_BUILD ?? '../pwa-update-build-old')
const newBuild = resolve(process.env.PWA_NEW_BUILD ?? '../pwa-update-build-new')
const nextBuild = resolve(process.env.PWA_NEXT_BUILD ?? '../pwa-update-build-next')
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/pwa-update-audit')
await mkdir(out, { recursive: true })
const [candidate, next] = await Promise.all([newBuild, nextBuild].map(async path => JSON.parse(await readFile(resolve(path, 'build-info.json'), 'utf8'))))
assert.notDeepEqual(candidate, next, 'next release must have different actual bundled build metadata')
assert.equal(await readFile(resolve(nextBuild, 'auth/v1/open.html'), 'utf8'), await readFile(resolve(nextBuild, 'index.html'), 'utf8'))
let build = oldBuild
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/dostigator\//, '')
    if (path.includes('..')) { response.writeHead(400).end(); return }
    let file = resolve(build, path || 'index.html')
    if (!extname(file)) file = resolve(build, 'index.html')
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(await readFile(file))
  } catch { response.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const result = { checks: [], errors: [], failures: [], candidate, next }
const check = name => { result.checks.push(name); console.log('PASS ' + name) }
const open = async () => {
  const page = await context.newPage()
  page.on('pageerror', error => result.errors.push(error.message))
  await page.goto(origin + '/dostigator/login')
  await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  return page
}
const requestWorkerCheck = page => page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update() })
const waitForNaturalActivation = async () => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const states = await Promise.all(context.serviceWorkers().map(worker => worker.evaluate(() => !self.registration.waiting && self.registration.active?.state === 'activated').catch(() => false)))
    if (states.some(Boolean)) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('waiting worker did not activate after its final legacy client closed')
}
let page
try {
  page = await open()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload(); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('unsent-old@example.test')
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  build = newBuild
  await requestWorkerCheck(page)
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))
  await page.waitForTimeout(800)
  assert.equal(navigations, 0); assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-old@example.test')
  check('deployed autoUpdate runtime keeps unsent input while the candidate worker waits')
  await page.screenshot({ path: resolve(out, '390-old-client-unsent-preserved.png'), fullPage: true })
  await page.close(); await waitForNaturalActivation()
  page = await open()
  await page.locator('.auth-version').filter({ hasText: candidate.commit.slice(0, 7) }).waitFor()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('unsent-new@example.test')
  const second = await open()
  await second.getByRole('textbox', { name: 'Email', exact: true }).fill('unsent-second-tab@example.test')
  navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  let secondNavigations = 0
  second.on('framenavigated', frame => { if (frame === second.mainFrame()) secondNavigations++ })
  build = nextBuild
  await page.clock.install(); await page.clock.fastForward(60_001)
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await page.clock.resume()
  const notice = page.getByRole('complementary', { name: 'Обновление приложения' })
  await notice.getByText('Доступно обновление', { exact: true }).waitFor()
  await notice.getByTitle(next.commit).waitFor()
  check('foreground check discovers the actual published version and SHA without a manual worker call')
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))
  assert.equal(navigations, 0); assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-new@example.test')
  check('metadata and waiting-worker discovery preserve entered text and do not navigate')
  for (const width of [375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = await notice.evaluate(element => ({ overflow: document.documentElement.scrollWidth - innerWidth, height: element.getBoundingClientRect().height, controls: [...element.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) }))
    assert.equal(layout.overflow, 0); assert.ok(layout.height <= 88); assert.ok(layout.controls.every(height => height >= 44))
    await page.screenshot({ path: resolve(out, `${width}-compact-update.png`), fullPage: true, animations: 'disabled' })
    check(`${width}px notice stays compact, has no overflow and provides 44px controls`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await notice.getByRole('button', { name: 'Подробнее', exact: true }).click()
  await notice.getByRole('button', { name: 'Позже', exact: true }).click()
  await notice.getByRole('button', { name: 'Подробнее', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await notice.getByRole('button', { name: 'Обновить приложение', exact: true }).click()
  assert.equal(navigations, 0); assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-new@example.test')
  check('postpone and cancelled confirmation keep the form intact')
  await page.screenshot({ path: resolve(out, '390-expanded-update.png'), fullPage: true, animations: 'disabled' })
  page.once('dialog', dialog => dialog.accept())
  const [freshResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/auth/v1/open.html')),
    notice.getByRole('button', { name: 'Обновить приложение', exact: true }).click(),
  ])
  assert.equal(freshResponse.status(), 200); assert.equal(freshResponse.fromServiceWorker(), false)
  await page.locator('.auth-version').filter({ hasText: next.commit.slice(0, 7) }).waitFor()
  assert.ok(navigations >= 1)
  check('confirmed update opens this tab through the network alias with the next actual bundled SHA')
  await second.waitForTimeout(500)
  assert.equal(secondNavigations, 0); assert.equal(await second.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-second-tab@example.test')
  assert.equal(await second.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting)), true)
  check('fresh navigation leaves the shared worker waiting and the other tab unsent input unchanged')
  await second.screenshot({ path: resolve(out, '390-other-tab-unsent-preserved.png'), fullPage: true })
  assert.equal(result.errors.length, 0); check('real service worker update flow has no unhandled JavaScript errors')
} catch (error) {
  result.failures.push({ message: error.message, stack: error.stack }); process.exitCode = 1
  await page?.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2))
  await browser.close(); await new Promise(resolve => server.close(resolve))
}
