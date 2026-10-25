import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_AUDIT_ORIGIN ?? 'http://127.0.0.1:4192'
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))
const moduleUrl = origin + '/@fs' + resolve('src/lib/cardio-photo-store.ts')
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/cardio-photo-store-upgrade')
await mkdir(output, { recursive: true })
const result = { checks: [], failures: [] }
for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'Chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/Users/risat/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' } : {}) })
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await context.route(origin + '/__photo-store-upgrade', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated IndexedDB upgrade</title>' }))
    const page = await context.newPage()
    await page.goto(origin + '/__photo-store-upgrade')
    const report = await page.evaluate(async moduleUrl => {
      const owner = 'upgrade-owner', foreign = 'other-owner', cardioA = 'cardio-a', cardioB = 'cardio-b'
      const bytes = [255, 216, 255, 219, 4, 3, 2, 1, 255, 217]
      const row = (id, userId, cardioId, state, acknowledged = false) => ({ key: `${userId}:${id}`, id, userId, cardioId, path: `${userId}/cardio/${cardioId}/${id}.jpg`, bytes: bytes.length, sha256: 'a'.repeat(64), createdAt: '2026-10-25T10:00:00Z', state, deleteAcknowledged: acknowledged, blob: null, imageBytes: acknowledged ? null : Uint8Array.from(bytes).buffer, storageVersion: 'preserved-' + id })
      const rows = [row('synced-a', owner, cardioA, 'synced'), row('synced-b', owner, cardioB, 'synced'), row('upload-a', owner, cardioA, 'upload'), row('delete-b', owner, cardioB, 'delete'), row('delete-acked', owner, cardioB, 'delete', true), row('foreign-upload', foreign, cardioA, 'upload')]
      const open = version => new Promise((resolve, reject) => {
        const request = indexedDB.open('dostigator-cardio-photos', version)
        request.onupgradeneeded = () => { const store = request.result.createObjectStore('photos', { keyPath: 'key' }); store.createIndex('owner', 'userId') }
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
      })
      const old = await open(1)
      await new Promise((resolve, reject) => { const tx = old.transaction('photos', 'readwrite'); for (const value of rows) tx.objectStore('photos').put(value); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
      old.close()
      const calls = [], getAll = IDBIndex.prototype.getAll
      IDBIndex.prototype.getAll = function (query, count) { calls.push({ index: this.name, query }); return getAll.call(this, query, count) }
      const { readPhotos, readPendingPhoto, readPhoto } = await import(moduleUrl)
      const scoped = await readPhotos(owner, cardioA)
      const first = await readPendingPhoto(owner)
      const next = await readPendingPhoto(owner, new Set([first.id]))
      const empty = await readPendingPhoto(owner, new Set([first.id, next.id]))
      const marker = await readPhoto('delete-acked', owner), saved = await readPhoto('synced-a', owner)
      IDBIndex.prototype.getAll = getAll
      const upgraded = await open(2)
      const raw = await new Promise((resolve, reject) => { const tx = upgraded.transaction('photos'); const request = tx.objectStore('photos').getAll(); tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error) })
      const indexes = [...upgraded.transaction('photos').objectStore('photos').indexNames], version = upgraded.version
      upgraded.close()
      const normalize = values => values.map(value => ({ ...value, imageBytes: value.imageBytes ? [...new Uint8Array(value.imageBytes)] : null })).sort((a, b) => a.key.localeCompare(b.key))
      return { version, indexes, scopedIds: scoped.map(value => value.id).sort(), cursorIds: [first.id, next.id], empty: empty === undefined, readCalls: calls, bytesPreserved: JSON.stringify([...new Uint8Array(await saved.blob.arrayBuffer())]) === JSON.stringify(bytes), markerPreserved: marker.state === 'delete' && marker.deleteAcknowledged && marker.blob === null, rowsUnchanged: JSON.stringify(normalize(raw)) === JSON.stringify(normalize(rows)) }
    }, moduleUrl)
    assert.equal(report.version, 2)
    assert.deepEqual(report.indexes, ['owner', 'ownerCardio', 'ownerState'])
    assert.deepEqual(report.scopedIds, ['synced-a', 'upload-a'])
    assert.deepEqual(report.cursorIds, ['delete-b', 'upload-a'])
    assert.ok(report.empty && report.bytesPreserved && report.markerPreserved && report.rowsUnchanged)
    assert.deepEqual(report.readCalls, [{ index: 'ownerCardio', query: ['upgrade-owner', 'cardio-a'] }], 'queue must not call getAll or load synced images')
    result.checks.push({ browser: name, test: 'v1-to-v2-preserves-bytes-markers-and-rows; scoped-read-and-single-pending-cursors', ...report })
    await context.close()
  } catch (error) { result.failures.push({ browser: name, message: error.message }) }
  finally { await browser.close() }
}
await writeFile(resolve(output, 'upgrade-results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (result.failures.length) process.exitCode = 1
