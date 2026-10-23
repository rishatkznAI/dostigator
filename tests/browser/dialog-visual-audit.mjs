import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_TEST_ORIGIN || 'http://127.0.0.1:4210'
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT || '.cache/dialog-visual-audit')
await mkdir(output, { recursive: true })
const result = { checks: [], errors: [], failures: [], screens: [] }
for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'chromium' && process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.on('pageerror', error => result.errors.push({ engine: name, message: error.message }))
  const capture = async kind => {
    for (const width of [375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 })
      const filename = `${name}-${width}-${kind}.png`
      await page.screenshot({ path: resolve(output, filename), animations: 'disabled' })
      const bounds = await page.getByRole('dialog').evaluate(dialog => {
        const sheet = dialog.getBoundingClientRect()
        const handle = dialog.querySelector('.sheet-handle').getBoundingClientRect()
        return { top: sheet.top, bottom: sheet.bottom, left: sheet.left, right: sheet.right, handleTop: handle.top, handleBottom: handle.bottom, handleCenter: (handle.left + handle.right) / 2, overflow: document.documentElement.scrollWidth - innerWidth }
      })
      assert.ok(bounds.handleTop >= bounds.top && bounds.handleBottom <= bounds.bottom, 'handle stays inside its dialog')
      assert.ok(Math.abs(bounds.handleCenter - (bounds.left + bounds.right) / 2) < 2, 'handle is centered in its dialog')
      assert.equal(bounds.overflow, 0, 'no page overflow')
      if (kind === 'correction') {
        const height = await page.getByRole('combobox').evaluate(select => select.getBoundingClientRect().height)
        assert.ok(height >= 44, 'RIR selector provides a mobile touch target in WebKit too')
      }
      result.checks.push(`${name} ${width}px ${kind}: handle inside, centered, no overflow`)
      result.screens.push(filename)
    }
  }
  try {
    await page.goto(origin + '/__test/login')
    await page.getByRole('heading', { name: /Привет/ }).waitFor()
    await page.waitForLoadState('networkidle')
    await page.goto(origin + '/training/workout/A')
    await page.getByRole('button', { name: 'Начать тренировку', exact: true }).click()
    await page.getByRole('button', { name: 'Как делать', exact: true }).click()
    await capture('technique')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /^Упражнение 1 из/ }).click()
    await capture('exercise-list')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Завершить', exact: true }).click()
    await capture('finish')
    await page.keyboard.press('Escape')
    await page.getByRole('spinbutton', { name: /подход 1, вес/ }).fill('40')
    await page.getByRole('spinbutton', { name: /подход 1, повторы/ }).fill('10')
    await page.getByRole('button', { name: /^Записать подход 1/ }).click()
    await page.getByRole('button', { name: 'Завершить', exact: true }).click()
    await page.getByRole('button', { name: 'Сохранить неполную тренировку', exact: true }).click()
    await page.waitForURL('**/training/history?finished=*')
    await page.getByText('Синхронизировано с сервером', { exact: true }).first().waitFor()
    await page.getByRole('button', { name: /^Исправить Жим ногами, подход 1/ }).first().click()
    await capture('correction')
  } catch (error) {
    result.failures.push({ engine: name, message: error.message })
    process.exitCode = 1
  } finally { await browser.close() }
}
if (result.errors.length) process.exitCode = 1
await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ checks: result.checks.length, errors: result.errors, failures: result.failures }, null, 2))
