import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium, webkit } from 'playwright'

// Explicit opt-in, fixed independent project and live Vite configuration check
// precede authentication or any disposable writes. Never accept production.
assert.equal(process.env.DOSTIGATOR_PHOTO_AUDIT, '1', 'Explicit isolated hosted photo audit opt-in is required')
assert.equal(process.env.AUDIT_PROJECT_REF, 'xorlzijpgklasatxzcnn')
const host = 'xorlzijpgklasatxzcnn.supabase.co'
const apiUrl = process.env.VITE_SUPABASE_URL
assert.equal(new URL(apiUrl).hostname, host)
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY, password = process.env.AUDIT_PASSWORD
assert.ok(key && password, 'Isolated fixture configuration is missing')
const origin = process.env.DOSTIGATOR_AUDIT_ORIGIN ?? 'http://127.0.0.1:4194'
assert.equal(origin, 'http://127.0.0.1:4194', 'Only the real-auth isolated local app stand is allowed')
const configured = await fetch(origin + '/src/lib/supabase.ts').then(response => { assert.ok(response.ok); return response.text() })
const injectedUrl = configured.match(/"VITE_SUPABASE_URL"\s*:\s*"([^"]+)"/)?.[1]
const injectedKey = configured.match(/"VITE_SUPABASE_PUBLISHABLE_KEY"\s*:\s*"([^"]+)"/)?.[1]
assert.equal(new URL(injectedUrl).hostname, host, 'Live app must target the independent project')
assert.ok(injectedKey === key, 'Live app key must match the explicitly selected independent project')
const output = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/cardio-photo-hosted-ui')
await mkdir(output, { recursive: true })
const email = 'audit-a@example.invalid', bucket = 'trainlog-progress-photos'
const redact = value => String(value).replaceAll(password, '[password]').replaceAll(key, '[key]').replaceAll(email, '[fixture-account]').replace(/eyJ[A-Za-z0-9_.-]{30,}/g, '[token]').replace(/(token|apikey|authorization)=[^\s&]+/gi, '$1=[redacted]')
const client = createClient(apiUrl, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init = {}) => {
  assert.equal(new URL(typeof input === 'string' ? input : input.url ?? input.toString()).hostname, host, 'API request must remain inside the independent project')
  return fetch(input, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(20000)]) })
} } })
const ok = (response, operation) => { if (response.error) throw new Error(`${operation}: ${response.error.message}`); return response.data }
const login = ok(await client.auth.signInWithPassword({ email, password }), 'fixture login')
const owner = login.user.id
const result = { independentProject: 'xorlzijpgklasatxzcnn', cases: [], failures: [], pageErrors: [], teardownErrors: [], rejectedOrigins: [], cleanup: [], productionTraffic: false, physicalPhone: false }
const disposableParents = new Set()
const storeModule = origin + '/src/lib/cardio-photo-store.ts'
const check = (condition, message) => assert.ok(condition, message)
const serverPhoto = async id => ok(await client.from('cardio_result_photos').select('id,user_id,cardio_id,object_path,byte_size,sha256,deleted_at').eq('id', id).eq('user_id', owner).maybeSingle(), 'read disposable photo metadata')
const serverParent = async id => ok(await client.from('cardio_facts').select('id,user_id,duration_seconds,speed_kmh,incline_percent,revision,deleted_at').eq('id', id).eq('user_id', owner).maybeSingle(), 'read disposable cardio')
const waitUntil = async (read, predicate, label) => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(label)
}
const uncachedDownload = async path => fetch(`${apiUrl}/storage/v1/object/authenticated/${bucket}/${path}?audit=${randomUUID()}`, { headers: { apikey: key, Authorization: `Bearer ${login.session.access_token}`, 'Cache-Control': 'no-cache' }, cache: 'no-store', signal: AbortSignal.timeout(20000) })

try {
  for (const [engineName, engine] of [['Chromium', chromium], ['WebKit', webkit]].filter(([name]) => !process.env.DOSTIGATOR_AUDIT_BROWSER || name.toLowerCase() === process.env.DOSTIGATOR_AUDIT_BROWSER.toLowerCase())) {
    const browser = await engine.launch({ headless: true, ...(engineName === 'Chromium' ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH ?? '/Users/risat/Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' } : {}) })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    const traffic = { photoUploads: 0, photoDownloads: 0, photoRemovals: 0, metadataRequests: 0 }
    const privateReadHeaders = []
    let stage = 'login', parentId
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === origin || url.hostname === host || ['blob:', 'data:'].includes(url.protocol)) return route.continue()
      result.rejectedOrigins.push({ browser: engineName, hostname: url.hostname, method: request.method() })
      return route.abort()
    })
    page.on('pageerror', error => (stage === 'teardown' ? result.teardownErrors : result.pageErrors).push({ browser: engineName, stage, message: redact(error.message) }))
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.hostname !== host) return
      if (url.pathname.includes('/storage/v1/object/') && request.method() === 'POST') traffic.photoUploads++
      if (url.pathname.includes('/storage/v1/object/') && url.pathname.includes(`/${bucket}/`) && !url.pathname.includes('/public/') && request.method() === 'GET') {
        traffic.photoDownloads++
        privateReadHeaders.push(request.allHeaders().then(headers => Boolean(headers.authorization?.startsWith('Bearer ') && headers.apikey === key)))
      }
      if (url.pathname.includes('/storage/v1/object/') && request.method() === 'DELETE') traffic.photoRemovals++
      if (url.pathname.includes('/rest/v1/cardio_result_photos')) traffic.metadataRequests++
    })
    try {
      await page.addInitScript(owner => localStorage.setItem(`dostigator:onboarding:v1:${owner}`, 'skipped'), owner)
      await page.goto(origin + '/login')
      await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
      await page.getByLabel('Пароль', { exact: true }).fill(password)
      await page.getByRole('button', { name: 'Войти', exact: true }).click()
      await page.waitForURL(url => !url.pathname.includes('login'))
      await page.getByRole('link', { name: 'Зал', exact: true }).click()
      await page.locator('a[href="/training/cardio"]').click()
      await page.getByRole('heading', { name: 'Кардио', exact: true }).waitFor()
      const browserOwner = await page.evaluate(async () => (await (await import('/src/lib/supabase.ts')).supabase.auth.getUser()).data.user?.id)
      assert.equal(browserOwner, owner)
      stage = 'save-cardio'
      await page.getByRole('button', { name: 'Уже сделал · записать время', exact: true }).click()
      await page.getByLabel('Фактическое время, мин', { exact: true }).fill('20')
      await page.getByLabel('Фактическое время, секунды', { exact: true }).fill('17')
      await page.getByLabel('Скорость, км/ч', { exact: true }).fill('6,5')
      await page.getByLabel('Наклон, %', { exact: true }).fill('3,5')
      await page.getByRole('button', { name: 'Детали занятия · необязательно', exact: true }).click()
      const marker = `Disposable hosted UI photo audit ${engineName} ${randomUUID()}`
      await page.getByLabel('Заметка по кардио', { exact: true }).fill(marker)
      parentId = await page.evaluate(owner => JSON.parse(localStorage.getItem(`trainlog:cardio-draft:${owner}`)).id, owner)
      disposableParents.add(parentId)
      await page.getByRole('button', { name: 'Сохранить кардио', exact: true }).click()
      await page.getByRole('heading', { name: 'Кардио сохранено', exact: true }).waitFor()
      await page.locator('.cardio-saved').getByText('Кардио синхронизировано с сервером', { exact: true }).waitFor()
      const parent = await serverParent(parentId)
      assert.deepEqual([parent.duration_seconds, parent.speed_kmh, parent.incline_percent], [1217, 6.5, 3.5])
      check(parent.revision > 0 && !parent.deleted_at, 'Cardio must be acknowledged before photo upload')
      const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800
        const context = canvas.getContext('2d'); context.fillStyle = '#142b32'; context.fillRect(0, 0, 1200, 800)
        context.fillStyle = '#ffc857'; context.font = 'bold 70px sans-serif'; context.fillText('SYNTHETIC AUDIT', 100, 220)
        context.fillStyle = '#fff'; context.font = '56px sans-serif'; context.fillText('20:17 / 6.5 km/h / 3.5%', 100, 400)
        return canvas.toDataURL('image/png').split(',')[1]
      })
      const file = { name: 'synthetic-cardio.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') }
      let panel = page.locator('.cardio-saved .cardio-result-photos')
      const localRows = () => page.evaluate(async ({ storeModule, owner, parentId }) => (await (await import(storeModule)).readPhotos(owner)).filter(photo => photo.cardioId === parentId).map(photo => ({ id: photo.id, state: photo.state, acknowledgedDelete: Boolean(photo.deleteAcknowledged), bytes: photo.bytes, hash: photo.sha256, blobBytes: photo.blob?.size ?? 0, mime: photo.blob?.type ?? null })), { storeModule, owner, parentId })
      stage = 'upload-and-cloud-ack'
      await panel.scrollIntoViewIfNeeded()
      await page.waitForFunction(() => !document.querySelector('.cardio-saved .cardio-photo-actions button')?.disabled)
      await panel.getByLabel('Фото из галереи').setInputFiles(file)
      await panel.getByText('Фото синхронизировано', { exact: true }).waitFor()
      const local = (await localRows()).find(photo => photo.state === 'synced')
      check(local && local.mime === 'image/jpeg' && local.blobBytes === local.bytes && local.bytes > 0 && local.bytes <= 2097152, 'Prepared JPEG must remain locally after cloud ACK')
      const metadata = await serverPhoto(local.id)
      assert.deepEqual([metadata.cardio_id, metadata.user_id, metadata.byte_size, metadata.sha256, metadata.deleted_at], [parentId, owner, local.bytes, local.hash, null])
      assert.equal(metadata.object_path, `${owner}/cardio/${parentId}/${local.id}.jpg`)
      const uploaded = await uncachedDownload(metadata.object_path)
      check(uploaded.ok, 'Authenticated server download must succeed')
      const bytes = Buffer.from(await uploaded.arrayBuffer())
      assert.equal(bytes.length, local.bytes)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), local.hash)
      check(traffic.photoUploads >= 1, 'Photo upload must originate from the actual app UI')
      stage = 'reload-and-private-download'
      // Discard only this disposable fixture's image cache, preserving metadata,
      // so the actual UI must exercise authenticated cloud download on reload.
      await page.evaluate(async ({ storeModule, owner, id }) => (await import(storeModule)).changePhoto(owner, id, photo => photo ? { ...photo, blob: null } : photo), { storeModule, owner, id: local.id })
      await page.reload()
      panel = page.locator('.cardio-saved .cardio-result-photos')
      await panel.scrollIntoViewIfNeeded()
      await panel.getByRole('button', { name: 'Открыть фото 1', exact: true }).click()
      const preview = page.getByRole('dialog', { name: 'Фото результата кардио', exact: true })
      await preview.getByAltText('Снимок результата кардио').waitFor()
      await page.waitForFunction(() => document.querySelector('.cardio-photo-full')?.naturalWidth === 1200)
      check(traffic.photoDownloads >= 1, 'Reloaded UI must use private authenticated Storage download')
      check((await Promise.all(privateReadHeaders)).every(Boolean), 'Every UI photo download must carry authenticated private headers')
      const cachedAgain = (await localRows()).find(photo => photo.id === local.id)
      assert.deepEqual([cachedAgain.blobBytes, cachedAgain.hash], [local.bytes, local.hash])
      await page.screenshot({ path: resolve(output, engineName.toLowerCase() + '-private-preview.png'), fullPage: false })
      await preview.getByRole('button', { name: 'Закрыть', exact: true }).click()
      await preview.waitFor({ state: 'hidden' })
      stage = 'delete-photo'
      await panel.getByRole('button', { name: 'Удалить фото 1', exact: true }).click()
      await page.getByRole('dialog', { name: 'Удалить фото результата?', exact: true }).getByRole('button', { name: 'Удалить это фото', exact: true }).click()
      await waitUntil(() => serverPhoto(local.id), photo => Boolean(photo?.deleted_at), 'Photo tombstone was not acknowledged')
      await waitUntil(localRows, rows => !rows.some(row => row.id === local.id && !row.acknowledgedDelete), 'Photo deletion did not leave an acknowledged local marker')
      await page.waitForFunction(() => document.querySelectorAll('.cardio-saved .cardio-photo-thumbnail').length === 0)
      const removed = await uncachedDownload(metadata.object_path)
      check(!removed.ok, 'New authenticated download must not find a removed photo')
      check(traffic.photoRemovals >= 1, 'Photo removal must originate from the actual UI')
      const stillPresent = await serverParent(parentId)
      assert.deepEqual([stillPresent.duration_seconds, stillPresent.speed_kmh, stillPresent.incline_percent, stillPresent.deleted_at], [1217, 6.5, 3.5, null])
      stage = 'attach-photo-for-parent-cleanup'
      await panel.scrollIntoViewIfNeeded()
      await panel.getByLabel('Фото из галереи').setInputFiles(file)
      await panel.getByText('Фото синхронизировано', { exact: true }).waitFor()
      const second = (await localRows()).find(photo => photo.state === 'synced' && photo.id !== local.id)
      check(second, 'A live second photo is required to prove cardio deletion cleanup')
      const secondMetadata = await serverPhoto(second.id)
      stage = 'delete-cardio-and-attached-photo'
      await page.getByRole('button', { name: /История кардио ·/ }).click()
      const card = page.locator('.cardio-log-card').filter({ hasText: marker })
      await card.getByRole('button', { name: /Удалить сохранённое кардио/ }).click()
      await page.getByRole('dialog', { name: 'Удалить сохранённую тренировку?', exact: true }).getByRole('button', { name: 'Удалить эту тренировку', exact: true }).click()
      await waitUntil(() => serverParent(parentId), parent => Boolean(parent?.deleted_at), 'Cardio deletion was not acknowledged')
      await waitUntil(() => serverPhoto(second.id), photo => Boolean(photo?.deleted_at), 'Attached photo cleanup after cardio deletion was not acknowledged')
      await waitUntil(localRows, rows => rows.every(row => row.acknowledgedDelete), 'Attached local photos were not fully acknowledged as deleted')
      const removedWithParent = await uncachedDownload(secondMetadata.object_path)
      check(!removedWithParent.ok, 'Cardio deletion must remove its active private image')
      assert.equal(await card.count(), 0)
      check(traffic.photoUploads >= 2 && traffic.photoRemovals >= 2, 'Both UI photo lifecycles must reach Storage')
      await page.screenshot({ path: resolve(output, engineName.toLowerCase() + '-after-cleanup.png'), fullPage: true })
      result.cases.push({ browser: engineName, width: 390, realLogin: true, cardio: { seconds: 1217, speedKmh: 6.5, inclinePercent: 3.5 }, jpeg: { bytes: local.bytes, sha256: local.hash }, actualUiPrivateDownload: true, photoTombstone: true, cardioDeletionCleansActivePhoto: true, traffic })
      console.log('PASS ' + engineName + ': full isolated UI photo lifecycle')
    } catch (error) {
      result.failures.push({ browser: engineName, stage, message: redact(error.message) })
      await page.screenshot({ path: resolve(output, engineName.toLowerCase() + '-failure.png'), fullPage: !(await page.getByRole('dialog').count()) }).catch(() => {})
    } finally {
      stage = 'teardown'
      await page.evaluate(async () => (await import('/src/lib/supabase.ts')).supabase.auth.signOut({ scope: 'local' })).catch(() => {})
      await context.close(); await browser.close()
    }
  }
} finally {
  for (const id of disposableParents) {
    try {
      const photos = ok(await client.from('cardio_result_photos').select('id,user_id,cardio_id,object_path,deleted_at').eq('cardio_id', id).eq('user_id', owner), 'read cleanup metadata')
      for (const photo of photos) {
        assert.equal(photo.user_id, owner); assert.equal(photo.cardio_id, id)
        assert.equal(photo.object_path, `${owner}/cardio/${id}/${photo.id}.jpg`)
        if (!photo.deleted_at) ok(await client.from('cardio_result_photos').update({ deleted_at: new Date().toISOString() }).eq('id', photo.id).eq('user_id', owner), 'cleanup photo tombstone')
        ok(await client.storage.from(bucket).remove([photo.object_path]), 'cleanup private file')
      }
      const parent = await serverParent(id)
      if (parent && !parent.deleted_at) ok(await client.rpc('cardio_apply_fact', { p_id: id, p_mutation_id: randomUUID(), p_expected_revision: parent.revision, p_record: null, p_delete: true, p_expected_owner: owner }), 'cleanup disposable cardio')
      result.cleanup.push({ cardioId: id, ok: true, photoCount: photos.length })
    } catch (error) { result.cleanup.push({ cardioId: id, ok: false, message: redact(error.message) }) }
  }
  await client.auth.signOut({ scope: 'local' }).catch(() => {})
  await writeFile(resolve(output, 'hosted-ui-results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ cases: result.cases.length, failures: result.failures, pageErrors: result.pageErrors, rejectedOrigins: result.rejectedOrigins, cleanup: result.cleanup, output }, null, 2))
  if (result.failures.length || result.pageErrors.length || result.rejectedOrigins.length || result.cleanup.some(entry => !entry.ok)) process.exitCode = 1
}
