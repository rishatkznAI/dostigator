import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, webkit } from 'playwright'

const origin = process.env.DOSTIGATOR_AUDIT_ORIGIN ?? 'http://127.0.0.1:4192'
assert.ok(/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin), 'Only the isolated local stand is allowed')
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/cardio-photo-store')
const storeModule = origin + '/@fs' + resolve('src/lib/cardio-photo-store.ts')
await mkdir(output, { recursive: true })
const owner = 'synthetic-photo-store-owner'
const result = { checks: [], failures: [] }
for (const [name, engine] of [['Chromium', chromium], ['WebKit', webkit]]) {
  const browser = await engine.launch({ headless: true, ...(name === 'Chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/Users/risat/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' } : {}) })
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    await context.addInitScript(() => { localStorage.setItem('local-test:seeded', 'true'); localStorage.setItem('local-test:online', 'false'); localStorage.setItem('trainlog:cardio:local-training-test', '[]') })
    const first = await context.newPage(), second = await context.newPage()
    await Promise.all([first.goto(origin + '/training/cardio'), second.goto(origin + '/training/cardio')])
    try {
      const before = await first.evaluate(async ({ storeModule, owner }) => {
        const { insertPhoto, readPhoto, photoKey } = await import(storeModule)
        const id = '00000000-0000-4000-8000-000000000001', cardioId = '00000000-0000-4000-8000-000000000002'
        const blob = new Blob([new Uint8Array([255, 216, 255, 219, 1, 2, 3, 4, 255, 217])], { type: 'image/jpeg' })
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('')
        await insertPhoto({ key: photoKey(owner, id), id, userId: owner, cardioId, path: `${owner}/cardio/${cardioId}/${id}.jpg`, bytes: blob.size, sha256: hash, createdAt: new Date().toISOString(), state: 'upload', blob })
        const saved = await readPhoto(id, owner)
        return { id, bytes: saved.blob.size, hash: saved.sha256 }
      }, { storeModule, owner })
      await first.evaluate(async ({ storeModule, owner, id }) => {
        const { changePhoto } = await import(storeModule)
        const nativeArrayBuffer = Blob.prototype.arrayBuffer
        let intercept = true
        Blob.prototype.arrayBuffer = function () {
          const reading = nativeArrayBuffer.call(this)
          if (!intercept) return reading
          intercept = false
          return reading.then(buffer => new Promise(resolve => { window.__photoEncodeBlocked = true; window.__releasePhotoEncode = () => resolve(buffer) }))
        }
        window.__photoAcknowledgement = changePhoto(owner, id, current => current?.state === 'upload' ? { ...current, state: 'synced' } : current)
      }, { storeModule, owner, id: before.id })
      await first.waitForFunction(() => window.__photoEncodeBlocked === true)
      await second.evaluate(async ({ storeModule, owner, id }) => {
        const { changePhoto } = await import(storeModule)
        await changePhoto(owner, id, current => current ? { ...current, state: 'delete' } : current)
      }, { storeModule, owner, id: before.id })
      const after = await first.evaluate(async ({ storeModule, owner, id }) => {
        window.__releasePhotoEncode()
        await window.__photoAcknowledgement
        const { readPhoto } = await import(storeModule), record = await readPhoto(id, owner)
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await record.blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('')
        return { state: record.state, bytes: record.blob.size, hash: record.sha256, actualDigest: digest }
      }, { storeModule, owner, id: before.id })
      assert.equal(after.state, 'delete', 'late upload acknowledgement must never overwrite another tab deletion')
      assert.equal(after.bytes, before.bytes)
      assert.equal(after.hash, before.hash)
      assert.equal(after.actualDigest, before.hash)
      result.checks.push({ browser: name, test: 'intertab-delete-vs-upload-ack', state: after.state, bytesUnchanged: true, digestUnchanged: true })
    } catch (error) { result.failures.push({ browser: name, test: 'intertab-delete-vs-upload-ack', message: error.message }) }
    if (name === 'Chromium') try {
      const legacy = await second.evaluate(async ({ storeModule, owner }) => {
        const id = '00000000-0000-4000-8000-000000000003', cardioId = '00000000-0000-4000-8000-000000000004'
        const bytes = new Uint8Array([255, 216, 255, 219, 4, 3, 2, 1, 255, 217]), blob = new Blob([bytes], { type: 'image/jpeg' })
        const raw = { key: `${owner}:${id}`, id, userId: owner, cardioId, path: `${owner}/cardio/${cardioId}/${id}.jpg`, bytes: blob.size, sha256: 'a'.repeat(64), createdAt: new Date().toISOString(), state: 'upload', blob }
        const db = await new Promise((resolve, reject) => { const request = indexedDB.open('dostigator-cardio-photos', 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
        await new Promise((resolve, reject) => { const tx = db.transaction('photos', 'readwrite'); tx.objectStore('photos').put(raw); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) }); db.close()
        const { readPhoto, changePhoto } = await import(storeModule)
        const first = await readPhoto(id, owner), firstBytes = [...new Uint8Array(await first.blob.arrayBuffer())]
        await changePhoto(owner, id, current => ({ ...current, state: 'synced' }))
        const next = await readPhoto(id, owner), nextBytes = [...new Uint8Array(await next.blob.arrayBuffer())]
        return { legacyReadExact: firstBytes.every((value, index) => value === bytes[index]), convertedReadExact: nextBytes.every((value, index) => value === bytes[index]), state: next.state, mimeType: next.blob.type }
      }, { storeModule, owner })
      assert.deepEqual(legacy, { legacyReadExact: true, convertedReadExact: true, state: 'synced', mimeType: 'image/jpeg' })
      result.checks.push({ browser: name, test: 'legacy-blob-compatible-read-and-conversion', ...legacy })
    } catch (error) { result.failures.push({ browser: name, test: 'legacy-blob-compatible-read-and-conversion', message: error.message }) }
    await context.close()
  } finally { await browser.close() }
}
await writeFile(resolve(output, 'store-results.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
if (result.failures.length) process.exitCode = 1
