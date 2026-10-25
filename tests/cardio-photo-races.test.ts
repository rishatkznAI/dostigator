import { beforeEach, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import type { CardioPhoto } from '../src/lib/cardio-photo-store'
import { deleteCardioResultPhotos, loadCardioPhotos, photoDigest, syncCardioPhotos } from '../src/lib/cardio-photos'

const mock = vi.hoisted(() => ({
  local: new Map<string, CardioPhoto>(), remote: new Map<string, Record<string, unknown>>(), parents: new Map<string, Record<string, unknown>>(),
  blobs: new Map<string, Blob>(), upload: vi.fn(), remove: vi.fn(), getUser: vi.fn(), remoteRead: vi.fn(),
}))
vi.mock('../src/lib/cardio-photo-store', () => ({
  CARDIO_PHOTO_CHANGED: 'photos:race-test', photoKey: (owner: string, id: string) => `${owner}:${id}`,
  readPhotos: async (owner: string, cardioId?: string) => [...mock.local.values()].filter(row => row.userId === owner && (!cardioId || row.cardioId === cardioId)),
  readPendingPhoto: async (owner: string, skip: Set<string> = new Set()) => [...mock.local.values()].find(row => row.userId === owner && row.state !== 'synced' && !row.deleteAcknowledged && !skip.has(row.id)),
  readPhoto: async (id: string, owner: string) => mock.local.get(`${owner}:${id}`),
  insertPhoto: async (row: CardioPhoto) => { mock.local.set(row.key, row) },
  changePhoto: async (owner: string, id: string, update: (row: CardioPhoto | undefined) => CardioPhoto | undefined) => {
    const key = `${owner}:${id}`, next = update(mock.local.get(key))
    if (next) mock.local.set(key, next); else mock.local.delete(key)
  },
}))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  auth: { getUser: mock.getUser }, storage: { from: () => ({ upload: mock.upload, remove: mock.remove }) },
  from: (table: string) => {
    let action = 'read', payload: Record<string, unknown> = {}, single = false
    const filters: Array<[string, unknown]> = []
    const chain = {
      select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain },
      maybeSingle: () => { single = true; return chain }, single: () => { single = true; return chain },
      upsert: (row: Record<string, unknown>) => { action = 'insert'; payload = row; return chain },
      update: (row: Record<string, unknown>) => { action = 'update'; payload = row; return chain },
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
        const execute = async () => {
          const records = table === 'cardio_facts' ? mock.parents : mock.remote
          if (action === 'insert') {
            const parent = mock.parents.get(String(payload.cardio_id))
            // Production's BEFORE INSERT owner/active-parent guard runs even
            // for an ON CONFLICT DO NOTHING duplicate.
            if (!parent || parent.user_id !== payload.user_id || (!payload.deleted_at && parent.deleted_at)) return { data: null, error: { code: '42501', message: 'active photo requires an active parent' } }
            if (!records.has(String(payload.id))) records.set(String(payload.id), { created_at: '2026-10-25T12:00:00Z', deleted_at: null, ...payload })
          }
          const rows = [...records.values()].filter(row => filters.every(([key, value]) => row[key] === value))
          if (action === 'update') for (const row of rows) Object.assign(row, { ...payload, deleted_at: row.deleted_at ?? payload.deleted_at })
          // Capture the server snapshot before holding the response. Mutations
          // committed meanwhile must not retroactively alter this old response.
          const snapshot = rows.map(row => ({ ...row }))
          if (table === 'cardio_result_photos' && action === 'read') await mock.remoteRead()
          return { data: single ? snapshot[0] ?? null : snapshot, error: null }
        }
        return execute().then(resolve, reject)
      },
    }
    return chain
  },
} }))

const owner = '10000000-0000-4000-8000-000000000001', cardio = '20000000-0000-4000-8000-000000000002'
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
const meta = (row: CardioPhoto) => ({ id: row.id, user_id: row.userId, cardio_id: row.cardioId, object_path: row.path, byte_size: row.bytes, sha256: row.sha256, created_at: row.createdAt, deleted_at: null })
async function photo(state: CardioPhoto['state']): Promise<CardioPhoto> {
  const blob = new NodeBlob(['race-regression-jpeg'], { type: 'image/jpeg' }) as unknown as Blob
  const id = crypto.randomUUID(), row: CardioPhoto = { key: `${owner}:${id}`, id, userId: owner, cardioId: cardio, path: `${owner}/cardio/${cardio}/${id}.jpg`, bytes: blob.size, sha256: await photoDigest(blob), createdAt: '2026-10-25T12:00:00Z', state, blob }
  mock.local.set(row.key, row)
  mock.parents.set(cardio, { id: cardio, user_id: owner, deleted_at: null })
  return row
}
beforeEach(() => {
  vi.resetAllMocks(); mock.local.clear(); mock.remote.clear(); mock.parents.clear(); mock.blobs.clear()
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mock.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null })
  mock.remoteRead.mockResolvedValue(undefined)
  mock.remove.mockImplementation(async (paths: string[]) => { paths.forEach(path => mock.blobs.delete(path)); return { error: null } })
})

it('never resurrects an acknowledged local tombstone from an older active metadata response', async () => {
  const row = await photo('synced')
  mock.remote.set(row.id, meta(row)); mock.blobs.set(row.path, row.blob!)
  const captured = deferred(), release = deferred()
  mock.remoteRead.mockImplementationOnce(async () => { captured.resolve(); await release.promise })
  const loading = loadCardioPhotos(owner, cardio)
  await captured.promise
  await deleteCardioResultPhotos(owner, cardio)
  expect(mock.remote.get(row.id)?.deleted_at).toBeTruthy()
  release.resolve(); await loading
  expect(mock.local.get(row.key)).toMatchObject({ state: 'delete', deleteAcknowledged: true, blob: null })
  expect(mock.blobs.has(row.path)).toBe(false)
})

it.each(['remove-response-last', 'late-remove-fails-then-retries'] as const)('removes a late uploaded blob after parent deletion (%s)', async mode => {
  const row = await photo('upload')
  const uploadStarted = deferred(), uploadCommit = deferred(), removeCommitted = deferred(), removeResponse = deferred()
  mock.upload.mockImplementationOnce(async () => {
    uploadStarted.resolve(); await uploadCommit.promise
    mock.blobs.set(row.path, row.blob!)
    return { error: null }
  })
  // Storage evaluated the first delete before this upload existed, but its
  // response is delayed. A second remove after the upload commits is required.
  mock.remove.mockImplementationOnce(async (paths: string[]) => {
    paths.forEach(path => mock.blobs.delete(path)); removeCommitted.resolve()
    await removeResponse.promise
    return { error: null }
  })
  if (mode === 'late-remove-fails-then-retries') mock.remove.mockImplementationOnce(async () => ({ error: { message: 'late remove connection lost' } }))
  const uploading = syncCardioPhotos(owner).then(() => ({ error: undefined }), error => ({ error }))
  await uploadStarted.promise
  mock.parents.get(cardio)!.deleted_at = '2026-10-25T12:02:00Z'
  const deleting = deleteCardioResultPhotos(owner, cardio)
  await removeCommitted.promise
  let outcome
  if (mode === 'late-remove-fails-then-retries') {
    // This time the original deletion ACK is already durable before the late
    // upload commits. Its new cleanup must become pending before network IO.
    removeResponse.resolve(); await deleting
    expect(mock.local.get(row.key)?.deleteAcknowledged).toBe(true)
    uploadCommit.resolve(); outcome = await uploading
    expect(outcome.error).toMatchObject({ message: 'late remove connection lost' })
    expect(mock.blobs.has(row.path)).toBe(true)
    expect(mock.local.get(row.key)).toMatchObject({ state: 'delete', deleteAcknowledged: false })
    await syncCardioPhotos(owner)
  } else {
    try { uploadCommit.resolve(); outcome = await uploading }
    finally { removeResponse.resolve(); await deleting }
    expect(outcome?.error).toBeUndefined()
  }
  expect(mock.blobs.has(row.path)).toBe(false)
  expect(mock.remove.mock.calls.length).toBeGreaterThanOrEqual(2)
  expect(mock.remote.get(row.id)?.deleted_at).toBeTruthy()
  expect(mock.local.get(row.key)).toMatchObject({ state: 'delete', deleteAcknowledged: true, blob: null })
})
