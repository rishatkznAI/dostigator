import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { chromium } from 'playwright'

// Explicit opt-in and exact independent project: never accept a production URL.
assert.equal(process.env.DOSTIGATOR_PHOTO_AUDIT, '1', 'hosted photo audit requires explicit opt-in')
assert.equal(process.env.AUDIT_PROJECT_REF, 'xorlzijpgklasatxzcnn')
const url = process.env.VITE_SUPABASE_URL
assert.equal(new URL(url).hostname, 'xorlzijpgklasatxzcnn.supabase.co')
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY, password = process.env.AUDIT_PASSWORD
assert.ok(key && password)
const client = () => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(15000)]) }) },
})
const a = client(), b = client(), anon = client(), bucket = 'trainlog-progress-photos'
const out = resolve(process.env.DOSTIGATOR_AUDIT_OUTPUT ?? '.cache/cardio-photos-hosted')
await mkdir(out, { recursive: true })
const result = { checks: [], failures: [], disposableParents: [], cleanup: [], productionTraffic: false, physicalPhone: false }
const uploaded = [], rows = [], parents = []
const check = name => { result.checks.push(name); console.log('PASS ' + name) }
const ok = response => { assert.equal(response.error, null, response.error?.message); return response.data }
const reject = response => { assert.ok(response.error, 'operation must be rejected'); return response.error }
let browser, ownerA, ownerB, stage = 'login'
const record = { activity_date: '2026-10-24', kind: 'walk', duration_minutes: 20, duration_seconds: 1200, workout_session_id: null, distance_km: null, average_pulse: null, effort: null, speed_kmh: null, incline_percent: null, resistance_level: null, note: 'Disposable hosted photo audit' }
const newParent = async (api, owner) => {
  const id = randomUUID()
  ok(await api.rpc('cardio_apply_fact', { p_id: id, p_mutation_id: randomUUID(), p_expected_revision: 0, p_record: record, p_expected_owner: owner }))
  parents.push({ api, owner, id, revision: 1 })
  return id
}
const metadata = (owner, cardio, jpeg, id = randomUUID()) => ({ id, user_id: owner, cardio_id: cardio, object_path: `${owner}/cardio/${cardio}/${id}.jpg`, byte_size: jpeg.length, sha256: createHash('sha256').update(jpeg).digest('hex') })

try {
  ownerA = ok(await a.auth.signInWithPassword({ email: 'audit-a@example.invalid', password })).user.id
  ownerB = ok(await b.auth.signInWithPassword({ email: 'audit-b@example.invalid', password })).user.id
  assert.notEqual(ownerA, ownerB)
  const parentA = await newParent(a, ownerA), parentB = await newParent(b, ownerB)
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } : {}) })
  const page = await browser.newPage()
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
    const context = canvas.getContext('2d'); context.fillStyle = '#345f87'; context.fillRect(0, 0, 32, 32)
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
  })
  await browser.close(); browser = null
  const jpeg = Buffer.from(encoded, 'base64'), photo = metadata(ownerA, parentA, jpeg)
  assert.ok(jpeg.length > 100 && jpeg.length <= 2097152)
  const uploadedPhoto = await a.storage.from(bucket).upload(photo.object_path, jpeg, { contentType: 'image/jpeg', upsert: false, cacheControl: '0' })
  ok(uploadedPhoto); uploaded.push({ api: a, path: photo.object_path })
  const saved = ok(await a.from('cardio_result_photos').insert(photo).select().single())
  rows.push({ api: a, owner: ownerA, ...photo })
  assert.equal(saved.sha256, photo.sha256)
  const downloaded = ok(await a.storage.from(bucket).download(photo.object_path))
  assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'), photo.sha256)
  check('real JPEG upload, immutable metadata insert and authenticated download retain exact bytes/hash')
  const duplicate = reject(await a.storage.from(bucket).upload(photo.object_path, jpeg, { contentType: 'image/jpeg', upsert: false }))
  // Storage documents both the legacy 400 AlreadyExists and current 409 shape.
  result.duplicateUploadStatus = String(duplicate.statusCode)
  assert.ok(['400', '409'].includes(result.duplicateUploadStatus))
  assert.match(duplicate.message, /exist|duplicate/i)
  const afterDuplicate = ok(await a.storage.from(bucket).download(photo.object_path))
  assert.equal(createHash('sha256').update(Buffer.from(await afterDuplicate.arrayBuffer())).digest('hex'), photo.sha256)
  check('duplicate upload is rejected and raw authenticated download keeps the original SHA256')

  const signed = ok(await a.storage.from(bucket).createSignedUrl(photo.object_path, 60))
  const signedResponse = await fetch(signed.signedUrl)
  assert.ok(signedResponse.ok)
  assert.equal(createHash('sha256').update(Buffer.from(await signedResponse.arrayBuffer())).digest('hex'), photo.sha256)
  reject(await b.storage.from(bucket).download(photo.object_path))
  reject(await b.storage.from(bucket).createSignedUrl(photo.object_path, 60))
  const publicUrl = anon.storage.from(bucket).getPublicUrl(photo.object_path).data.publicUrl
  assert.equal((await fetch(publicUrl)).ok, false)
  reject(await anon.storage.from(bucket).download(photo.object_path))
  reject(await b.storage.from(bucket).upload(`${ownerA}/cardio/${parentA}/${randomUUID()}.jpg`, jpeg, { contentType: 'image/jpeg' }))
  check('private bucket denies anonymous/public and foreign-user reads, signing and owner-folder uploads')

  assert.deepEqual(ok(await b.from('cardio_result_photos').select('id').eq('id', photo.id)), [])
  assert.deepEqual(ok(await b.from('cardio_result_photos').update({ deleted_at: new Date().toISOString() }).eq('id', photo.id).select('id')), [])
  reject(await a.from('cardio_result_photos').insert(metadata(ownerA, parentB, jpeg)))
  reject(await a.from('cardio_result_photos').insert(metadata(ownerB, parentB, jpeg)))
  reject(await anon.from('cardio_result_photos').select('id').eq('id', photo.id))
  reject(await a.from('cardio_result_photos').update({ sha256: 'b'.repeat(64) }).eq('id', photo.id))
  check('actual PostgREST RLS hides foreign metadata and denies foreign-parent, wrong-owner, anon and immutable-field writes')

  for (const invalid of [
    { ...metadata(ownerA, parentA, jpeg), byte_size: 0 },
    { ...metadata(ownerA, parentA, jpeg), byte_size: 2097153 },
    { ...metadata(ownerA, parentA, jpeg), sha256: 'A'.repeat(64) },
    { ...metadata(ownerA, parentA, jpeg), object_path: `${ownerA}/../invalid.jpg` },
  ]) assert.equal(reject(await a.from('cardio_result_photos').insert(invalid)).code, '23514')
  assert.deepEqual(ok(await a.from('cardio_result_photos').upsert(photo, { onConflict: 'id', ignoreDuplicates: true }).select('id')), [])
  check('hosted constraints reject malformed path, size and hash; exact ignore-duplicate retry needs no metadata UPDATE')

  stage = 'tombstone-write'
  const deletion = ok(await a.from('cardio_result_photos').update({ deleted_at: new Date().toISOString() }).eq('id', photo.id).eq('user_id', ownerA).select().single())
  assert.ok(deletion.deleted_at)
  assert.deepEqual(ok(await a.from('cardio_result_photos').upsert(photo, { onConflict: 'id', ignoreDuplicates: true }).select('id')), [])
  const afterRetry = ok(await a.from('cardio_result_photos').select().eq('id', photo.id).single())
  assert.equal(afterRetry.deleted_at, deletion.deleted_at)
  stage = 'forbidden-resurrection'
  reject(await a.from('cardio_result_photos').update({ deleted_at: null }).eq('id', photo.id))
  stage = 'forbidden-metadata-hard-delete'
  reject(await a.from('cardio_result_photos').delete().eq('id', photo.id))
  stage = 'storage-remove'
  const removedObjects = ok(await a.storage.from(bucket).remove([photo.object_path]))
  assert.equal(removedObjects.length, 1)
  stage = 'storage-read-after-remove'
  const cachedDownload = await a.storage.from(bucket).download(photo.object_path)
  result.cachedReadAfterRemoval = !cachedDownload.error
  if (cachedDownload.data) assert.equal(createHash('sha256').update(Buffer.from(await cachedDownload.data.arrayBuffer())).digest('hex'), photo.sha256)
  const folder = photo.object_path.slice(0, photo.object_path.lastIndexOf('/'))
  assert.deepEqual(ok(await a.storage.from(bucket).list(folder)), [])
  reject(await a.storage.from(bucket).createSignedUrl(photo.object_path, 60))
  const access = (await a.auth.getSession()).data.session.access_token
  const uncached = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${photo.object_path}?audit=${randomUUID()}`, {
    headers: { apikey: key, Authorization: `Bearer ${access}`, 'Cache-Control': 'no-cache' },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  })
  result.uncachedReadAfterRemovalStatus = uncached.status
  assert.equal(uncached.ok, false, 'new uncached authenticated request must not find the removed blob')
  check('tombstone precedes blob removal; fresh list/signing/uncached download deny it and late duplicate retry cannot resurrect metadata')

  const deletedParent = await newParent(a, ownerA)
  ok(await a.rpc('cardio_apply_fact', { p_id: deletedParent, p_mutation_id: randomUUID(), p_expected_revision: 1, p_record: null, p_delete: true, p_expected_owner: ownerA }))
  parents.find(parent => parent.id === deletedParent).revision = 2
  const delayed = metadata(ownerA, deletedParent, jpeg)
  reject(await a.from('cardio_result_photos').insert(delayed))
  const lateTombstone = { ...delayed, deleted_at: new Date().toISOString() }
  ok(await a.from('cardio_result_photos').insert(lateTombstone))
  rows.push({ api: a, owner: ownerA, ...lateTombstone })
  assert.ok(ok(await a.from('cardio_result_photos').select('deleted_at').eq('id', delayed.id).single()).deleted_at)
  check('softdeleted cardio parent rejects new active photo and accepts the owner tombstone before delayed metadata acknowledgement')
} catch (error) {
  // Never serialize SDK/session objects, headers, signed URLs, credentials or files.
  result.failures.push({ stage, message: error.message, code: error.code ?? null })
} finally {
  if (browser) await browser.close()
  for (const item of rows) {
    const response = await item.api.from('cardio_result_photos').update({ deleted_at: new Date().toISOString() }).eq('id', item.id).eq('user_id', item.owner)
    result.cleanup.push({ kind: 'photo-tombstone', ok: !response.error })
  }
  for (const item of uploaded) {
    const response = await item.api.storage.from(bucket).remove([item.path])
    result.cleanup.push({ kind: 'blob-remove', ok: !response.error })
  }
  for (const parent of parents) {
    if (parent.revision === 1) {
      const response = await parent.api.rpc('cardio_apply_fact', { p_id: parent.id, p_mutation_id: randomUUID(), p_expected_revision: 1, p_record: null, p_delete: true, p_expected_owner: parent.owner })
      result.cleanup.push({ kind: 'cardio-softdelete', ok: !response.error })
    }
    result.disposableParents.push(parent.id)
  }
  await Promise.allSettled([a.auth.signOut({ scope: 'local' }), b.auth.signOut({ scope: 'local' })])
  await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  if (result.failures.length || result.cleanup.some(item => !item.ok)) process.exitCode = 1
}
