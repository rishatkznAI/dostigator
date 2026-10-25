import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

// Default: the disposable local browser stand, with real product pages and shell.
// Other origins must already have an authenticated session or provide a fixture route.
const origin = process.env.DOSTIGATOR_TEST_ORIGIN || 'http://127.0.0.1:4192'
const route = process.env.DOSTIGATOR_DASHBOARD_PATH || 'training'
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT || '.cache/iphone-dashboard-audit')
const selected = process.env.DOSTIGATOR_BROWSER || 'all'
assert.ok(['all', 'chromium', 'webkit'].includes(selected), 'DOSTIGATOR_BROWSER must be all, chromium, or webkit')
const engines = selected === 'all' ? ['chromium', 'webkit'] : [selected]
const widths = [320, 360, 375, 390, 393, 414, 430, 443]
const result = { checks: [], screens: [], pageErrors: [], failures: [], physicalIPhone: false }
await mkdir(output, { recursive: true })

for (const engine of engines) {
  const executablePath = engine === 'chromium'
    ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH
    : process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      page.on('pageerror', error => result.pageErrors.push({ engine, width, message: error.message }))
      try {
        await page.goto(new URL(route, origin.replace(/\/?$/, '/')).href)
        await page.getByRole('heading', { name: 'Начать тренировку', exact: true }).waitFor()
        await page.locator('.template-card').last().waitFor()
        // Remove only the local stand's diagnostic toolbar, never product content.
        await page.addStyleTag({ content: '.preview-nav { display: none !important; }' })
        const geometry = await page.evaluate(() => {
          const bounds = element => {
            const box = element.getBoundingClientRect()
            return { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom }
          }
          const shortcuts = [...document.querySelectorAll('.training-shortcuts a')].map(element => {
            const label = element.querySelector('span')
            const range = document.createRange()
            range.selectNodeContents(label)
            return { box: bounds(element), label: bounds(label), lines: range.getClientRects().length, align: getComputedStyle(label).textAlign }
          })
          const description = document.querySelector('.training-program-description')
          const ring = document.querySelector('.week-ring')
          const fill = ring.querySelector('.week-ring-fill')
          return {
            shortcuts,
            overflow: document.documentElement.scrollWidth - innerWidth,
            description: { marginTop: getComputedStyle(description).marginTop, marginBottom: getComputedStyle(description).marginBottom },
            ring: { role: ring.getAttribute('role'), label: ring.getAttribute('aria-label'), min: Number(ring.getAttribute('aria-valuemin')), max: Number(ring.getAttribute('aria-valuemax')), value: Number(ring.getAttribute('aria-valuenow')), pathLength: Number(fill.getAttribute('pathLength')), offset: Number(fill.getAttribute('stroke-dashoffset')) },
          }
        })
        assert.equal(geometry.shortcuts.length, 4)
        for (const shortcut of geometry.shortcuts) {
          assert.equal(shortcut.lines, 1, 'the short label stays on one line at the default font size')
          assert.equal(shortcut.align, 'center')
          assert.ok(Math.abs(shortcut.box.x + shortcut.box.width / 2 - shortcut.label.x - shortcut.label.width / 2) <= 1, 'label is geometrically centred')
          assert.ok(shortcut.label.x >= shortcut.box.x && shortcut.label.x + shortcut.label.width <= shortcut.box.x + shortcut.box.width, 'label stays inside the target')
          assert.ok(shortcut.box.height >= 44, 'shortcut remains a touch target')
        }
        assert.equal(geometry.overflow, 0, 'dashboard has no horizontal document overflow')
        assert.equal(geometry.description.marginTop, '8px')
        assert.equal(geometry.description.marginBottom, '0px')
        assert.equal(geometry.ring.role, 'progressbar')
        assert.equal(geometry.ring.label, 'Обязательные тренировки за неделю')
        assert.equal(geometry.ring.min, 0)
        assert.equal(geometry.ring.max, 2)
        assert.ok([0, 1, 2].includes(geometry.ring.value))
        assert.equal(geometry.ring.pathLength, 100)
        assert.equal(geometry.ring.offset, 100 - geometry.ring.value * 50, 'ring fraction matches the accessible completed count')
        const viewportFile = `${engine}-${width}-viewport.png`
        await page.screenshot({ path: resolve(output, viewportFile), animations: 'disabled' })
        result.screens.push(viewportFile)

        await page.getByRole('link', { name: 'Начать тренировку C', exact: true }).focus()
        const focused = await page.evaluate(() => {
          const action = document.activeElement.getBoundingClientRect()
          const nav = document.querySelector('.bottom-nav').getBoundingClientRect()
          return { top: action.top, bottom: action.bottom, navTop: nav.top, height: action.height }
        })
        assert.ok(focused.top >= 0 && focused.bottom <= focused.navTop, 'focusing the last program action scrolls it above the fixed navigation')
        assert.ok(focused.height >= 44, 'start action remains a touch target')
        const focusFile = `${engine}-${width}-focused-program.png`
        await page.screenshot({ path: resolve(output, focusFile), animations: 'disabled' })
        result.screens.push(focusFile)
        result.checks.push({ engine, width, geometry, focused })
        console.log(`PASS ${engine} ${width}: dashboard labels, spacing, overflow, and navigation clearance`)
      } catch (error) {
        result.failures.push({ engine, width, message: error.message, stack: error.stack })
        await page.screenshot({ path: resolve(output, `${engine}-${width}-failure.png`), animations: 'disabled' }).catch(() => {})
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2))
assert.equal(result.failures.length, 0, JSON.stringify(result.failures))
assert.equal(result.pageErrors.length, 0, JSON.stringify(result.pageErrors))
assert.equal(result.checks.length, engines.length * widths.length)
console.log(`PASS ${result.checks.length} viewport/engine cases; ${result.screens.length} screenshots; no unhandled JavaScript errors`)
