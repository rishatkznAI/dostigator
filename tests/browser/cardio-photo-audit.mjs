import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_AUDIT_ORIGIN ?? 'http://127.0.0.1:4192'
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin), 'Only the isolated local stand is allowed')
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/cardio-photo')
await mkdir(output, { recursive: true })
const owner = 'local-training-test'
const result = { checks: [], failures: [], pageErrors: [], externalRequests: [] }

export async function seedSavedCardio(page) {
  await page.addInitScript(owner => {
    if (localStorage.getItem('cardio-photo-audit:seeded')) return
    localStorage.setItem('local-test:seeded', 'true')
    localStorage.setItem('local-test:online', 'false')
    localStorage.setItem(`trainlog:cardio:${owner}`, '[]')
    localStorage.setItem('cardio-photo-audit:seeded', 'true')
  }, owner)
  await page.goto(origin + '/training/cardio')
  await page.getByRole('button', { name: 'Уже сделал · записать время' }).click()
  await page.getByLabel('Фактическое время, мин', { exact: true }).fill('20')
  await page.getByLabel('Фактическое время, секунды', { exact: true }).fill('17')
  await page.getByLabel('Скорость, км/ч', { exact: true }).fill('6,75')
  await page.getByLabel('Наклон, %', { exact: true }).fill('2,25')
  await page.getByRole('button', { name: 'Сохранить кардио', exact: true }).click()
  await page.getByRole('heading', { name: 'Кардио сохранено', exact: true }).waitFor()
  await page.locator('.cardio-saved .cardio-result-photos').getByRole('button', { name: 'Из галереи', exact: true }).waitFor()
}

const storeRows = page => page.evaluate(owner => new Promise((resolve, reject) => {
  const open = indexedDB.open('dostigator-cardio-photos', 1)
  open.onerror = () => reject(new Error('Synthetic photo store unavailable'))
  open.onsuccess = () => {
    const db = open.result, tx = db.transaction('photos'), request = tx.objectStore('photos').index('owner').getAll(owner)
    tx.oncomplete = () => { db.close(); resolve(request.result.map(row => ({ id: row.id, cardioId: row.cardioId, owner: row.userId, state: row.state, bytes: row.bytes, hash: row.sha256, blobBytes: row.imageBytes?.byteLength ?? row.blob?.size ?? 0, blobType: row.imageBytes ? 'image/jpeg' : row.blob?.type ?? null }))) }
    tx.onerror = () => { db.close(); reject(new Error('Synthetic photo store read failed')) }
  }
}), owner)

async function textScale(page, scale) {
  await page.evaluate(scale => {
    for (const element of document.querySelectorAll('[data-photo-audit-font]')) {
      element.style.fontSize = element.dataset.photoAuditFont
      element.style.lineHeight = element.dataset.photoAuditLine
      delete element.dataset.photoAuditFont; delete element.dataset.photoAuditLine
    }
    if (scale === 1) return
    const measured = [...document.querySelectorAll('.training-module *:not(svg):not(svg *)')].map(element => ({ element, font: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight }))
    for (const { element, font, line } of measured) {
      element.dataset.photoAuditFont = element.style.fontSize; element.dataset.photoAuditLine = element.style.lineHeight
      element.style.fontSize = parseFloat(font) * scale + 'px'
      if (line !== 'normal') element.style.lineHeight = parseFloat(line) * scale + 'px'
    }
  }, scale)
}

async function geometry(page, label) {
  const value = await page.evaluate(() => {
    const visible = element => element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && !element.closest('[inert],[aria-hidden="true"]')
    const outsideText = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (!node.textContent.trim() || node.parentElement.closest('svg,script,style') || !visible(node.parentElement)) continue
      const range = document.createRange(); range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.left < -1 || rect.right > innerWidth + 1) outsideText.push({ text: node.textContent.trim().slice(0, 100), left: rect.left, right: rect.right })
    }
    const targets = [...document.querySelectorAll('.cardio-result-photos button,[role="dialog"] button')].filter(visible).map(button => ({ name: button.getAttribute('aria-label') || button.textContent.trim(), height: button.getBoundingClientRect().height }))
    return { overflow: document.documentElement.scrollWidth - innerWidth, outsideText, targets }
  })
  assert.equal(value.overflow, 0, label + ': horizontal overflow')
  assert.deepEqual(value.outsideText, [], label + ': text outside viewport')
  assert.ok(value.targets.every(target => target.height >= 44), label + ': touch target below 44px')
  return { phase: label, ...value }
}

for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(engineName === 'Chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/Users/risat/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' } : {}) })
  try {
    for (const width of [320, 390, 430]) for (const scale of [1, 2]) {
      const label = `${engineName.toLowerCase()}-${width}-text${scale * 100}`
      const context = await browser.newContext({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true })
      await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
        result.externalRequests.push({ case: label, origin: url.origin, method: route.request().method() })
        return route.abort()
      })
      const page = await context.newPage()
      page.on('pageerror', error => result.pageErrors.push({ case: label, message: error.message }))
      let phase = 'save-cardio'
      try {
        await seedSavedCardio(page)
        let panel = page.locator('.cardio-saved .cardio-result-photos')
        await page.waitForFunction(() => !document.querySelector('.cardio-saved .cardio-photo-actions button')?.disabled)
        const originalQueue = await page.evaluate(owner => localStorage.getItem(`trainlog:cardio-queue:${owner}`), owner)
        const originalDraft = await page.evaluate(owner => JSON.parse(localStorage.getItem(`trainlog:cardio-draft:${owner}`)), owner)
        phase = 'decode-failure'
        await panel.getByLabel('Фото из галереи').setInputFiles({ name: 'invalid.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('invalid synthetic image') })
        await panel.getByRole('alert').filter({ hasText: 'Не удалось прочитать снимок' }).waitFor()
        assert.equal((await storeRows(page)).length, 0)
        phase = 'attach-three'
        const image = await page.evaluate(() => {
          const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 900
          const context = canvas.getContext('2d'); context.fillStyle = '#172322'; context.fillRect(0, 0, 1600, 900)
          context.fillStyle = '#ffc857'; context.font = 'bold 90px sans-serif'; context.fillText('SYNTHETIC TEST', 120, 240)
          context.fillStyle = '#ffffff'; context.font = '70px sans-serif'; context.fillText('20:17 / 6.75 / 2.25%', 120, 430)
          return canvas.toDataURL('image/png').split(',')[1]
        })
        const files = [1, 2, 3].map(number => ({ name: `synthetic-result-${number}.png`, mimeType: 'image/png', buffer: Buffer.from(image, 'base64') }))
        await panel.getByLabel('Фото из галереи').setInputFiles(files)
        await panel.getByText('Прикреплено 3 фото. Чтобы добавить другое, удали одно из них.', { exact: true }).waitFor()
        await page.waitForFunction(() => document.querySelector('.cardio-saved .cardio-result-photos')?.getAttribute('aria-busy') === 'false')
        const rows = await storeRows(page)
        assert.equal(rows.length, 3)
        assert.ok(rows.every(row => row.owner === owner && row.cardioId === originalDraft.id && row.state === 'upload' && row.blobType === 'image/jpeg' && row.blobBytes === row.bytes && row.bytes > 0 && row.bytes <= 2 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(row.hash)))
        assert.equal(await panel.getByRole('button', { name: 'Из галереи', exact: true }).isDisabled(), true)
        await textScale(page, scale)
        const measurements = [await geometry(page, 'attached')]
        await panel.scrollIntoViewIfNeeded()
        await page.screenshot({ path: resolve(output, label + '-attached.png'), fullPage: true })
        phase = 'reload-and-view'
        await page.reload()
        panel = page.locator('.cardio-saved .cardio-result-photos')
        await panel.getByRole('button', { name: 'Открыть фото 1', exact: true }).waitFor()
        assert.deepEqual((await storeRows(page)).map(row => [row.id, row.hash, row.blobBytes]).sort(), rows.map(row => [row.id, row.hash, row.blobBytes]).sort())
        await panel.getByRole('button', { name: 'Открыть фото 1', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Фото результата кардио', exact: true })
        const full = dialog.getByAltText('Снимок результата кардио')
        await full.waitFor()
        await page.waitForFunction(() => document.querySelector('.cardio-photo-full')?.naturalWidth > 0)
        await textScale(page, scale)
        measurements.push(await geometry(page, 'preview'))
        await page.screenshot({ path: resolve(output, label + '-preview.png'), fullPage: true })
        await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        phase = 'cancel-and-delete'
        await panel.getByRole('button', { name: 'Удалить фото 1', exact: true }).click()
        let confirmation = page.getByRole('dialog', { name: 'Удалить фото результата?', exact: true })
        await confirmation.getByRole('button', { name: 'Оставить фото', exact: true }).click()
        assert.ok((await storeRows(page)).every(row => row.state === 'upload'))
        await panel.getByRole('button', { name: 'Удалить фото 1', exact: true }).click()
        confirmation = page.getByRole('dialog', { name: 'Удалить фото результата?', exact: true })
        await textScale(page, scale)
        measurements.push(await geometry(page, 'confirm-delete'))
        await confirmation.getByRole('button', { name: 'Удалить это фото', exact: true }).click()
        await panel.getByText('Удаление ждёт синхронизации', { exact: true }).waitFor()
        await page.reload()
        panel = page.locator('.cardio-saved .cardio-result-photos')
        await panel.getByText('Удаление ждёт синхронизации', { exact: true }).waitFor()
        assert.equal(await panel.getByRole('button', { name: /Открыть фото/ }).count(), 2)
        const deleted = await storeRows(page)
        assert.equal(deleted.length, 3)
        assert.equal(deleted.filter(row => row.state === 'delete' && row.blobBytes > 0).length, 1, 'local copy remains until cloud acknowledgement')
        assert.equal(await page.evaluate(owner => localStorage.getItem(`trainlog:cardio-queue:${owner}`), owner), originalQueue, 'photos never mutate the saved cardio payload')
        await textScale(page, scale)
        measurements.push(await geometry(page, 'pending-delete-after-reload'))
        await page.screenshot({ path: resolve(output, label + '-delete.png'), fullPage: true })
        result.checks.push({ browser: engineName, width, textScale: scale, localPhotos: rows.length, pendingDeletes: 1, unchangedCardio: true, measurements })
      } catch (error) {
        result.failures.push({ case: label, phase, message: error.message })
        await page.screenshot({ path: resolve(output, label + '-failure.png'), fullPage: true }).catch(() => {})
      } finally { await context.close() }
    }
  } finally { await browser.close() }
}
await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ cases: result.checks.length, failures: result.failures, pageErrors: result.pageErrors, externalRequests: result.externalRequests, output }, null, 2))
if (result.failures.length || result.pageErrors.length || result.externalRequests.length) process.exitCode = 1
