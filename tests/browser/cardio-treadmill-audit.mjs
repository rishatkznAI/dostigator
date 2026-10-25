import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_AUDIT_ORIGIN ?? 'http://127.0.0.1:4192'
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin), 'Use the local synthetic fixture stand only')
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/cardio-treadmill')
await mkdir(output, { recursive: true })
const owner = 'local-training-test'
const prior = { id: 'a152e29d-3fca-49a5-926a-0f01f5294b80', user_id: owner, activity_date: '2026-10-20', kind: 'walk', duration_minutes: 20, duration_seconds: 1200, speed_kmh: 5.5, incline_percent: 1.5, revision: 1, workout_session_id: null, distance_km: null, effort: null, average_pulse: null, note: '', created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z' }
const result = { browsers: ['Chromium', 'WebKit'], checks: [], failures: [], pageErrors: [] }

async function scaleText(page, scale) {
  await page.evaluate(scale => {
    for (const element of document.querySelectorAll('[data-cardio-audit-font]')) {
      element.style.fontSize = element.dataset.cardioAuditFont
      element.style.lineHeight = element.dataset.cardioAuditLine
      delete element.dataset.cardioAuditFont
      delete element.dataset.cardioAuditLine
    }
    if (scale === 1) return
    const original = [...document.querySelectorAll('.training-module *:not(svg):not(svg *)')].map(element => ({ element, font: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight }))
    for (const { element, font, line } of original) {
      element.dataset.cardioAuditFont = element.style.fontSize
      element.dataset.cardioAuditLine = element.style.lineHeight
      element.style.fontSize = parseFloat(font) * scale + 'px'
      if (line !== 'normal') element.style.lineHeight = parseFloat(line) * scale + 'px'
    }
  }, scale)
}

async function geometry(page, phase) {
  const measured = await page.evaluate(() => {
    const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !element.closest('[inert],[aria-hidden="true"]')
    const targets = [...document.querySelectorAll('#cardio-workout button,#cardio-workout input,#cardio-workout select')].filter(visible).map(element => ({ name: element.getAttribute('aria-label') || element.textContent.trim(), height: element.getBoundingClientRect().height }))
    const outsideText = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement
      if (!node.textContent.trim() || parent.closest('script,style,svg,summary') || !visible(parent)) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.left < -1 || rect.right > innerWidth + 1) outsideText.push({ text: node.textContent.trim().slice(0, 100), left: rect.left, right: rect.right })
    }
    const fieldset = document.querySelector('.cardio-treadmill-settings'), inputBounds = []
    if (fieldset) {
      const bounds = fieldset.getBoundingClientRect()
      for (const input of fieldset.querySelectorAll('input')) {
        const rect = input.getBoundingClientRect()
        inputBounds.push({ left: rect.left >= bounds.left, right: rect.right <= bounds.right, width: rect.width, top: rect.top, bottom: rect.bottom })
      }
    }
    const overlap = inputBounds.length === 2 && inputBounds[0].top < inputBounds[1].bottom - 1 && inputBounds[1].top < inputBounds[0].bottom - 1 && fieldset.querySelectorAll('input')[0].getBoundingClientRect().right > fieldset.querySelectorAll('input')[1].getBoundingClientRect().left + 1
    return { overflow: document.documentElement.scrollWidth - innerWidth, outsideText, targets, inputBounds, overlap }
  })
  assert.equal(measured.overflow, 0, `${phase}: horizontal overflow`)
  assert.deepEqual(measured.outsideText, [], `${phase}: text outside viewport`)
  assert.ok(measured.targets.every(target => target.height >= 44), `${phase}: touch targets below 44px`)
  assert.ok(measured.inputBounds.every(bounds => bounds.left && bounds.right), `${phase}: input outside its fieldset`)
  assert.equal(measured.overlap, false, `${phase}: treadmill inputs overlap`)
  return { phase, ...measured }
}

for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'Chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/Users/risat/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' } : {}) })
  try {
    for (const width of [320, 375, 390, 430]) for (const textScale of [1, 2]) {
      const label = `${name.toLowerCase()}-${width}-text${textScale * 100}`
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true })
      const page = await context.newPage()
      page.on('pageerror', error => result.pageErrors.push({ case: label, message: error.message }))
      let currentPhase = 'initial'
      try {
        await context.addInitScript(({ owner, prior }) => {
          if (!localStorage.getItem('treadmill-audit:seeded')) {
            localStorage.setItem('local-test:seeded', 'true')
            localStorage.setItem('local-test:online', 'false')
            localStorage.setItem(`trainlog:cardio:${owner}`, JSON.stringify([prior]))
            localStorage.setItem('treadmill-audit:seeded', 'true')
          }
        }, { owner, prior })
        await page.goto(origin + '/training/cardio')
        await page.getByRole('button', { name: 'Уже сделал · записать время' }).click()
        await page.getByLabel('Фактическое время, мин', { exact: true }).fill('20')
        await page.getByLabel('Фактическое время, секунды', { exact: true }).fill('17')
        const speed = page.getByRole('textbox', { name: 'Скорость, км/ч', exact: true })
        const incline = page.getByRole('textbox', { name: 'Наклон, %', exact: true })
        assert.equal(await speed.getAttribute('inputmode'), 'decimal')
        assert.equal(await speed.isVisible(), true)
        assert.equal(await incline.isVisible(), true)
        assert.equal(await page.getByRole('button', { name: 'Детали занятия · необязательно', exact: true }).getAttribute('aria-expanded'), 'false')
        await speed.fill('6,,75')
        await page.getByRole('button', { name: 'Сохранить кардио', exact: true }).click()
        await page.getByRole('alert').filter({ hasText: 'Дробную часть можно отделить' }).waitFor()
        assert.equal(await page.evaluate(owner => JSON.parse(localStorage.getItem(`trainlog:cardio-queue:${owner}`) ?? '[]').length, owner), 0)
        await speed.fill('6,75'); await incline.fill('2,25')
        await page.reload()
        assert.equal(await speed.inputValue(), '6,75')
        assert.equal(await incline.inputValue(), '2,25')
        await scaleText(page, textScale)
        currentPhase = 'recording'
        const measurements = [await geometry(page, currentPhase)]
        await page.screenshot({ path: resolve(output, label + '-recording.png'), fullPage: true })
        await page.getByRole('button', { name: 'Сохранить кардио', exact: true }).click()
        await page.getByRole('heading', { name: 'Кардио сохранено', exact: true }).waitFor()
        await scaleText(page, textScale)
        const savedFacts = page.locator('.cardio-saved .cardio-settings-facts')
        assert.ok((await savedFacts.textContent()).includes('6,75 км/ч'))
        assert.ok((await savedFacts.textContent()).includes('2,25 %'))
        currentPhase = 'saved'
        measurements.push(await geometry(page, currentPhase))
        await page.reload()
        await page.getByRole('button', { name: 'История кардио · 2', exact: true }).click()
        await page.locator('.cardio-history[data-open="true"]').waitFor()
        await page.waitForTimeout(220)
        await scaleText(page, textScale)
        const card = page.locator('.cardio-log-card').filter({ hasText: '6,75 км/ч' })
        assert.equal(await card.count(), 1)
        assert.ok((await card.textContent()).includes('2,25 %'))
        currentPhase = 'history'
        measurements.push(await geometry(page, currentPhase))
        await page.screenshot({ path: resolve(output, label + '-history.png'), fullPage: true })
        await card.getByRole('button', { name: /Редактировать кардио/ }).click()
        assert.equal(await speed.inputValue(), '6.75')
        assert.equal(await incline.inputValue(), '2.25')
        await incline.fill('-1,25')
        await page.getByRole('button', { name: 'Сохранить исправление', exact: true }).click()
        await page.getByRole('heading', { name: 'Исправление сохранено', exact: true }).waitFor()
        const queued = await page.evaluate(owner => JSON.parse(localStorage.getItem(`trainlog:cardio-queue:${owner}`) ?? '[]'), owner)
        assert.equal(queued.length, 1)
        assert.equal(queued[0].speed_kmh, 6.75)
        assert.equal(queued[0].incline_percent, -1.25)
        assert.equal(queued[0].duration_seconds, 1217)
        result.checks.push({ browser: name, width, textScale, measurements, queueCount: queued.length, factsVerified: true })
      } catch (error) {
        result.failures.push({ case: label, phase: currentPhase, message: error.message })
        await page.screenshot({ path: resolve(output, label + '-failure.png'), fullPage: true }).catch(() => {})
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ cases: result.checks.length, failures: result.failures, pageErrors: result.pageErrors, output }, null, 2))
if (result.failures.length || result.pageErrors.length) process.exitCode = 1
