import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

// Starts a disposable A workout in the isolated stand; never point this at production.
const origin = process.env.DOSTIGATOR_TEST_ORIGIN || 'http://127.0.0.1:4192'
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname), 'Use an isolated local test origin')
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT || '.cache/today-navigation')
const selected = process.env.DOSTIGATOR_BROWSER || 'all'
assert.ok(['all', 'chromium', 'webkit'].includes(selected))
const engines = selected === 'all' ? ['chromium', 'webkit'] : [selected]
const widths = [320, 375, 390, 430, 443, 768, 1280]
const results = { checks: [], pageErrors: [], failures: [] }
await mkdir(output, { recursive: true })
for (const engine of engines) {
  const executablePath = engine === 'chromium' ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH : process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 })
      page.setDefaultTimeout(10_000)
      page.on('pageerror', error => results.pageErrors.push({ engine, width, message: error.message }))
      try {
        if (process.env.DOSTIGATOR_LOGIN_PATH) await page.goto(new URL(process.env.DOSTIGATOR_LOGIN_PATH, origin).href)
        await page.goto(new URL('/training/workout/A', origin).href)
        await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
        await page.locator('.workout-session-title').waitFor()
        await page.locator('.training-record-button').waitFor()
        const recordTarget = await page.locator('.training-record-button').boundingBox()
        assert.ok(recordTarget.height >= 56, 'the workout record action retains its larger target')
        await page.goto(origin)
        const resume = page.getByRole('link', { name: 'Продолжить активную тренировку', exact: true })
        await resume.waitFor()
        assert.ok((await resume.boundingBox()).height >= 48, 'the resume action uses the shared control height')
        await page.addStyleTag({ content: '.preview-nav { display: none !important; }' })
        const tools = page.getByRole('navigation', { name: 'Записи и итоги' })
        await tools.getByRole('link', { name: 'Дневник', exact: true }).waitFor()
        assert.equal(await tools.getByRole('link', { name: 'Дневник', exact: true }).getAttribute('href'), '/journal')
        assert.equal(await tools.getByRole('link', { name: 'Итоги недели', exact: true }).getAttribute('href'), '/review')
        const geometry = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll('.bottom-nav > a:not(.app-brand)')].map(element => {
            const box = element.getBoundingClientRect()
            const label = element.querySelector('.nav-label').getBoundingClientRect()
            return { label: element.getAttribute('aria-label'), x: box.x, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, labelLeft: label.x, labelRight: label.right }
          })
          return { boxes, overflow: document.documentElement.scrollWidth - innerWidth, collisions: boxes.some((box, index) => boxes[index + 1] && box.x < boxes[index + 1].right && box.right > boxes[index + 1].x && box.top < boxes[index + 1].bottom && box.bottom > boxes[index + 1].top) }
        })
        assert.deepEqual(geometry.boxes.map(box => box.label), ['Сегодня', 'Зал', 'Питание', 'Цели', 'Профиль'])
        assert.equal(geometry.overflow, 0)
        assert.equal(geometry.collisions, false)
        assert.ok(geometry.boxes.every(box => box.width >= 44 && box.height >= 44 && box.labelLeft >= box.x && box.labelRight <= box.right), 'all five targets contain their full labels')
        await page.screenshot({ path: resolve(output, `${engine}-${width}-today.png`), fullPage: true, animations: 'disabled' })
        results.checks.push({ engine, width, geometry })
        console.log(`PASS ${engine} ${width}: Today resume, shared controls, five destinations, journal and review`)
      } catch (error) {
        results.failures.push({ engine, width, message: error.message, stack: error.stack })
        await page.screenshot({ path: resolve(output, `${engine}-${width}-failure.png`), fullPage: true }).catch(() => {})
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
}
await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2))
assert.equal(results.failures.length, 0, JSON.stringify(results.failures))
assert.equal(results.pageErrors.length, 0, JSON.stringify(results.pageErrors))
assert.equal(results.checks.length, widths.length * engines.length)
console.log(`PASS ${results.checks.length} viewport/engine cases; no unhandled JavaScript errors`)
