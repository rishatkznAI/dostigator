import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { chromium } from 'playwright'

// Build baseline main and the candidate with GITHUB_PAGES=true into independent
// output directories. This server never changes a shared HTTP/API fault mode.
const oldBuild = resolve(process.env.PWA_OLD_BUILD ?? '../pwa-update-build-old')
const newBuild = resolve(process.env.PWA_NEW_BUILD ?? '../pwa-update-build-new')
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/pwa-update-audit')
await mkdir(out, { recursive: true })
let build = oldBuild, workerEdition = 0
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/dostigator\//, '')
    if (path.includes('..')) { res.writeHead(400).end(); return }
    let file = resolve(build, path || 'index.html')
    if (!extname(file)) file = resolve(build, 'index.html')
    let body = await readFile(file)
    if (path === 'sw.js') body = Buffer.concat([body, Buffer.from(`\n// isolated update edition ${workerEdition}\n`)])
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const result = { checks: [], errors: [], failures: [] }
const check = name => { result.checks.push(name); console.log('PASS ' + name) }
const open = async () => {
  const page = await context.newPage()
  page.on('pageerror', error => result.errors.push(error.message))
  await page.goto(origin + '/dostigator/login')
  await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  return page
}
const update = page => page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update() })
let page
try {
  page = await open()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('unsent-old@example.test')
  let navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  build = newBuild
  await update(page)
  await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))
  await page.waitForTimeout(1500)
  assert.equal(navigations, 0); assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-old@example.test')
  check('deployed autoUpdate client keeps unsent input when the new prompt worker waits')
  await page.screenshot({ path: resolve(out, '390-old-client-unsent-preserved.png'), fullPage: true })
  await page.close()
  page = await open()
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller))
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('unsent-new@example.test')
  const second = await open()
  await second.getByRole('textbox', { name: 'Email', exact: true }).fill('unsent-second-tab@example.test')
  navigations = 0
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++ })
  let secondNavigations = 0
  second.on('framenavigated', frame => { if (frame === second.mainFrame()) secondNavigations++ })
  workerEdition++
  await update(page)
  await page.getByRole('button', { name: 'Обновить приложение', exact: true }).waitFor()
  await second.getByText('Доступно обновление', { exact: true }).waitFor()
  await page.waitForTimeout(800)
  assert.equal(navigations, 0); assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-new@example.test')
  check('candidate announces a real waiting worker without navigating or clearing unsent input')
  for (const width of [375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    const layout = await page.getByRole('complementary', { name: 'Обновление приложения' }).evaluate(notice => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      heights: Array.from(notice.querySelectorAll('button')).map(button => button.getBoundingClientRect().height),
    }))
    assert.equal(layout.overflow, 0)
    assert.ok(layout.heights.every(height => height >= 44))
    await page.screenshot({ path: resolve(out, `${width}-update-notice.png`), fullPage: true, animations: 'disabled' })
    check(`${width}px update notice has no overflow and provides 44px controls`)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'Позже', exact: true }).click()
  await page.getByRole('button', { name: 'Показать', exact: true }).click()
  page.once('dialog', dialog => dialog.dismiss())
  await page.getByRole('button', { name: 'Обновить приложение', exact: true }).click()
  assert.equal(navigations, 0); assert.equal(await page.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-new@example.test')
  check('postpone and cancel keep the entered form unchanged')
  await page.screenshot({ path: resolve(out, '390-prompt-unsent-preserved.png'), fullPage: true })
  page.once('dialog', dialog => dialog.accept())
  await Promise.all([page.waitForEvent('framenavigated', frame => frame === page.mainFrame()), page.getByRole('button', { name: 'Обновить приложение', exact: true }).click()])
  await page.getByRole('textbox', { name: 'Email', exact: true }).waitFor()
  assert.ok(navigations >= 1)
  check('explicitly confirmed update activates the worker and reloads the requesting tab')
  await second.waitForTimeout(800)
  assert.equal(secondNavigations, 0); assert.equal(await second.getByRole('textbox', { name: 'Email', exact: true }).inputValue(), 'unsent-second-tab@example.test')
  check('another tab activating the worker does not reload or clear this tab')
  await second.screenshot({ path: resolve(out, '390-other-tab-unsent-preserved.png'), fullPage: true })
  assert.equal(result.errors.length, 0); check('real service worker upgrade has no unhandled JavaScript errors')
} catch (error) {
  result.failures.push({ message: error.message, stack: error.stack }); process.exitCode = 1
  await page?.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {})
} finally {
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2)); await browser.close(); await new Promise(resolve => server.close(resolve))
}
