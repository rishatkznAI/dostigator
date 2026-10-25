import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_TEST_ORIGIN || 'http://127.0.0.1:4192'
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT || '.cache/training-disclosures-audit')
const selected = process.env.DOSTIGATOR_BROWSER || 'all'
assert.ok(['all', 'chromium', 'webkit'].includes(selected))
const engines = selected === 'all' ? ['chromium', 'webkit'] : [selected]
const widths = process.env.DOSTIGATOR_WIDTHS?.split(',').map(Number) || [320, 375, 390, 430, 443, 768, 1280]
const textScale = Number(process.env.DOSTIGATOR_TEXT_SCALE || 1)
assert.ok(textScale === 1 || textScale === 2)
const results = { textScale, checks: [], pageErrors: [], failures: [], physicalPhone: false }
const applyTextScale = page => textScale === 1 ? Promise.resolve() : page.evaluate(scale => {
  for (const element of document.querySelectorAll('[data-disclosure-audit-font]')) {
    element.style.fontSize = element.dataset.disclosureAuditFont
    element.style.lineHeight = element.dataset.disclosureAuditLine
    delete element.dataset.disclosureAuditFont
    delete element.dataset.disclosureAuditLine
  }
  const values = [...document.querySelectorAll('.training-module *:not(svg):not(svg *)')].map(element => ({ element, font: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight }))
  for (const { element, font, line } of values) {
    element.dataset.disclosureAuditFont = element.style.fontSize
    element.dataset.disclosureAuditLine = element.style.lineHeight
    element.style.fontSize = parseFloat(font) * scale + 'px'
    if (line !== 'normal') element.style.lineHeight = parseFloat(line) * scale + 'px'
  }
}, textScale)
await mkdir(output, { recursive: true })
for (const engine of engines) {
  const executablePath = engine === 'chromium' ? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || process.env.PLAYWRIGHT_EXECUTABLE_PATH : process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE_PATH
  const browser = await ({ chromium, webkit }[engine]).launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  try {
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: width < 768, hasTouch: width < 768 })
      const page = await context.newPage()
      page.setDefaultTimeout(10_000)
      page.on('pageerror', error => results.pageErrors.push({ engine, width, message: error.message }))
      try {
        await page.goto(origin + '/training/workout/A')
        const rules = page.getByRole('button', { name: 'Правила выполнения', exact: true })
        await rules.waitFor()
        await page.addStyleTag({ content: '.preview-nav { display: none !important; }' })
        await applyTextScale(page)
        const triggers = page.locator('.workout-preparation .training-disclosure-trigger')
        assert.equal(await triggers.count(), 3)
        for (const trigger of await triggers.all()) {
          assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
          assert.ok((await trigger.boundingBox()).height >= 48)
          assert.equal((await trigger.locator('.training-disclosure-cue').innerText()).trim(), 'Открыть')
        }
        await page.screenshot({ path: resolve(output, `${engine}-${width}-preparation.png`), fullPage: true, animations: 'disabled' })
        await rules.click()
        await page.waitForTimeout(220)
        assert.equal(await rules.getAttribute('aria-expanded'), 'true')
        assert.ok((await page.locator('.preparation-rules .training-disclosure-region').boundingBox()).height > 0)
        await rules.click()
        await page.waitForTimeout(220)
        assert.ok((await page.locator('.preparation-rules .training-disclosure-region').boundingBox()).height < 1)
        const readiness = page.getByRole('button', { name: 'Проверить готовность · необязательно', exact: true })
        await readiness.click()
        const note = page.locator('.preparation-readiness textarea')
        await note.fill('Мой ввод остаётся при сворачивании')
        await readiness.click()
        assert.equal(await note.inputValue(), 'Мой ввод остаётся при сворачивании')
        assert.equal(await note.evaluate(element => Boolean(element.closest('[inert]'))), true)
        await readiness.click()
        assert.equal(await note.inputValue(), 'Мой ввод остаётся при сворачивании')
        assert.equal(await page.locator('.readiness-card .check-row').evaluate(element => getComputedStyle(element).display), 'flex')
        const sliderHeight = (await page.getByRole('slider', { name: 'Сон', exact: true }).boundingBox()).height
        assert.ok(sliderHeight >= 44 && sliderHeight <= 52, 'readiness scales remain compact touch targets')
        await page.screenshot({ path: resolve(output, `${engine}-${width}-readiness-open.png`), fullPage: true, animations: 'disabled' })
        await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
        const list = page.getByRole('button', { name: /^Упражнение 1 из/ })
        await list.waitFor()
        await applyTextScale(page)
        assert.equal(await list.getAttribute('aria-haspopup'), 'dialog')
        assert.equal(await list.getAttribute('aria-expanded'), 'false')
        await list.scrollIntoViewIfNeeded()
        const scrollBefore = await page.evaluate(() => scrollY)
        await list.click()
        const dialog = page.getByRole('dialog', { name: 'Упражнения тренировки' })
        await dialog.waitFor()
        await applyTextScale(page)
        const close = dialog.getByRole('button', { name: 'Закрыть', exact: true })
        assert.equal(await close.evaluate(element => element === document.activeElement), true)
        assert.equal(await page.locator('#root').evaluate(element => element.inert), true)
        assert.equal(await page.locator('.sheet-backdrop').evaluate(element => getComputedStyle(element).backdropFilter), 'none')
        await page.keyboard.press('Shift+Tab')
        assert.equal(await dialog.getByRole('button').last().evaluate(element => element === document.activeElement), true)
        await page.keyboard.press('Tab')
        assert.equal(await close.evaluate(element => element === document.activeElement), true)
        await dialog.evaluate(element => { element.scrollTop = element.scrollHeight })
        assert.ok((await close.boundingBox()).y >= 0, 'close stays visible while sheet content scrolls')
        await page.screenshot({ path: resolve(output, `${engine}-${width}-exercise-list.png`), animations: 'disabled' })
        await close.click()
        await dialog.waitFor({ state: 'detached' })
        assert.equal(await list.evaluate(element => element === document.activeElement), true)
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - scrollBefore) <= 2, 'dismissal keeps the page scroll position')
        const tools = page.getByRole('button', { name: 'Разминка и замена упражнения', exact: true })
        await tools.click()
        await page.getByRole('spinbutton', { name: 'Шаг оборудования, кг', exact: true }).fill('2.5')
        await tools.click(); await tools.click()
        assert.equal(await page.getByRole('spinbutton', { name: 'Шаг оборудования, кг', exact: true }).inputValue(), '2.5')
        const reserve = page.getByRole('button', { name: 'Запас повторов · необязательно', exact: true })
        await reserve.click()
        const rir = page.getByRole('combobox', { name: /запас повторов/ })
        await rir.selectOption('2')
        await reserve.click(); await reserve.click()
        assert.equal(await rir.inputValue(), '2')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
        await page.goto(origin + '/training/cardio')
        const reference = page.getByRole('button', { name: 'Темп и безопасность', exact: true })
        await reference.waitFor()
        await applyTextScale(page)
        await reference.click()
        await page.getByRole('link', { name: 'Интенсивность · CDC' }).waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
        results.checks.push({ engine, width, name: 'visible disclosure cues, retained fields, modal focus and scroll', status: 'PASS' })
        console.log(`PASS ${engine} ${width}: disclosure, fields, focus, scroll`)
      } catch (error) {
        results.failures.push({ engine, width, message: error.message, stack: error.stack })
        console.error(`FAIL ${engine} ${width}: ${error.message}`)
        await page.screenshot({ path: resolve(output, `${engine}-${width}-failure.png`), fullPage: true }).catch(() => {})
      } finally {
        await context.close()
      }
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    try {
      await page.goto(origin + '/training/workout/A')
      await page.getByRole('button', { name: 'Правила выполнения', exact: true }).click()
      assert.equal(await page.locator('.preparation-rules .training-disclosure-region').evaluate(element => getComputedStyle(element).transitionProperty), 'none')
      await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
      const list = page.getByRole('button', { name: /^Упражнение 1 из/ })
      await list.click()
      const dialog = page.getByRole('dialog', { name: 'Упражнения тренировки' })
      assert.equal(await dialog.evaluate(element => getComputedStyle(element).animationName), 'none')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await list.evaluate(element => element === document.activeElement), true)
      results.checks.push({ engine, width: 390, name: 'reduced motion without sheet or disclosure animation', status: 'PASS' })
      console.log(`PASS ${engine}: reduced motion`)
    } catch (error) {
      results.failures.push({ engine, width: 390, reducedMotion: true, message: error.message })
    } finally { await context.close() }
  } finally { await browser.close() }
}
await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2))
assert.equal(results.failures.length, 0, JSON.stringify(results.failures))
assert.equal(results.pageErrors.length, 0, JSON.stringify(results.pageErrors))
console.log(`PASS ${results.checks.length} cases; no unhandled JavaScript errors`)
