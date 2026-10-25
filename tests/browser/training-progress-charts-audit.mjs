import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { webkit } from 'playwright'

const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/training-progress-charts')
await mkdir(out, { recursive: true })
const owner = 'local-training-test', key = 'custom:11111111-1111-4111-8111-111111111111'
const exerciseName = 'Своя горизонтальная тяга с опорой грудью и длинным названием для проверки маленького экрана'
const history = Array.from({ length: 5 }, (_, index) => {
  const day = `2026-10-${15 + index * 2}`
  return { id: `chart-session-${index}`, title: 'Тест графиков', templateCode: 'A', startedAt: `${day}T10:00:00Z`, finishedAt: `${day}T11:00:00Z`, timerPausedDurationMs: 0, readinessMode: null,
    exercises: [{ id: `chart-exercise-${index}`, exerciseKey: key, exerciseName, target: '8–12', sortOrder: 1, skipped: false, skipReason: '',
      sets: Array.from({ length: 3 }, (_, number) => ({ id: `chart-set-${index}-${number}`, setNumber: number + 1, weightKg: index === 2 ? null : 40 + index * 1.25, reps: 8 + index, rir: null, done: true, isWarmup: false, completedAt: `${day}T11:00:00Z` })) }] }
})
const browser = await webkit.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
const result = { browser: 'WebKit', checks: [], failures: [], errors: [] }
let lastGeometry
page.on('pageerror', error => result.errors.push(error.message))
try {
  await page.addInitScript(({ owner, history }) => {
    localStorage.setItem(`trainlog:history-cache:${owner}`, JSON.stringify(history))
    localStorage.setItem('local-test:online', 'false')
  }, { owner, history })
  await page.goto((process.env.DOSTIGATOR_AUDIT_ORIGIN ?? 'http://127.0.0.1:4192') + '/training/progress')
  await page.getByRole('img', { name: /Максимальный записанный вес/ }).waitFor()
  assert.equal(await page.getByLabel('Упражнение для сравнения').inputValue(), key)
  assert.equal(await page.locator('.training-metric-line').getAttribute('d').then(path => (path.match(/M/g) ?? []).length), 2, 'missing weight must break the line')
  for (const details of await page.locator('.training-metric-values > summary').all()) await details.click()
  for (const width of [320, 375, 390, 430, 768, 1280]) for (const scale of [1, 2]) {
    await page.setViewportSize({ width, height: 844 })
    await page.evaluate(() => { for (const element of document.querySelectorAll('[data-chart-audit-font]')) { element.style.fontSize = element.dataset.chartAuditFont; element.style.lineHeight = element.dataset.chartAuditLine; delete element.dataset.chartAuditFont; delete element.dataset.chartAuditLine } })
    if (scale === 2) await page.evaluate(() => {
      const values = [...document.querySelectorAll('.training-module *:not(svg):not(svg *)')].map(element => ({ element, font: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight }))
      for (const { element, font, line } of values) { element.dataset.chartAuditFont = element.style.fontSize; element.dataset.chartAuditLine = element.style.lineHeight; element.style.fontSize = parseFloat(font) * 2 + 'px'; if (line !== 'normal') element.style.lineHeight = parseFloat(line) * 2 + 'px' }
    })
    for (const metric of ['Вес', 'Повторы', 'Подходы']) {
      await page.getByRole('group', { name: 'Показатель упражнения' }).getByRole('button', { name: metric, exact: true }).click()
      const geometry = await page.evaluate(() => {
        const overflow = document.documentElement.scrollWidth - innerWidth
        const targets = [...document.querySelectorAll('.training-metric-switch button,.training-comparable-toggle,.training-metric-values summary')].map(element => ({ text: element.textContent.trim(), height: element.getBoundingClientRect().height }))
        const outsideText = []
        for (const region of document.querySelectorAll('.training-progress-charts')) {
          const bounds = region.getBoundingClientRect(), walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT)
          while (walker.nextNode()) {
            const node = walker.currentNode
            if (!node.textContent.trim() || node.parentElement.closest('svg') || !node.parentElement.checkVisibility()) continue
            const range = document.createRange(); range.selectNodeContents(node)
            for (const rect of range.getClientRects()) if (rect.x < bounds.x - 1 || rect.right > bounds.right + 1) outsideText.push(node.textContent.trim())
          }
        }
        const overflowingBoxes = [...document.querySelectorAll('body *')].filter(element => { const rect = element.getBoundingClientRect(); return element.checkVisibility() && rect.width && rect.right > innerWidth + 1 }).slice(0, 12).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width }))
        const outsidePageText = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        while (walker.nextNode()) { const node = walker.currentNode; if (!node.textContent.trim() || node.parentElement.closest('svg,script,style') || !node.parentElement.checkVisibility()) continue; const range = document.createRange(); range.selectNodeContents(node); for (const rect of range.getClientRects()) if (rect.right > innerWidth + 1) outsidePageText.push({ text: node.textContent.trim().slice(0, 100), tag: node.parentElement.tagName, className: node.parentElement.className, right: rect.right }) }
        return { overflow, targets, outsideText, overflowingBoxes, outsidePageText, scrollX, viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }
      })
      lastGeometry = geometry
      assert.equal(geometry.overflow, 0, `${width}px/${scale}x/${metric} horizontal overflow`)
      assert.deepEqual(geometry.outsideText, [], `${width}px/${scale}x/${metric} text outside chart`)
      assert.ok(geometry.targets.every(target => target.height >= 44), 'chart controls must provide at least44px touch height')
      result.checks.push({ width, textScale: scale, metric, ...geometry })
    }
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: resolve(out, `${width}-text${scale * 100}.png`), fullPage: true })
  }
  assert.deepEqual(result.errors, [])
} catch (error) { result.failures.push({ message: error.message, stack: error.stack, geometry: lastGeometry }); process.exitCode = 1; await page.screenshot({ path: resolve(out, 'failure.png'), fullPage: true }).catch(() => {}) }
finally { await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ checks: result.checks.length, failures: result.failures, errors: result.errors, output: out }, null, 2)); await browser.close() }
