import { beforeEach, expect, it, vi } from 'vitest'
import { Blob as NodeBlob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import type { CardioPhoto } from '../src/lib/cardio-photo-store'
import { cardioPhotoBlob, deleteCardioResultPhotos, loadCardioPhotos, photoDigest, removeCardioPhoto, syncCardioPhotos } from '../src/lib/cardio-photos'
const mock = vi.hoisted(() => ({ local: new Map<string, CardioPhoto>(), remote: new Map<string, Record<string, unknown>>(), parents: new Map<string, Record<string, unknown>>(), upload: vi.fn(), download: vi.fn(), remove: vi.fn(), getUser: vi.fn() }))
vi.mock('../src/lib/cardio-photo-store', () => ({
  CARDIO_PHOTO_CHANGED: 'photos:test', photoKey: (owner: string, id: string) => `${owner}:${id}`,
  readPhotos: async (owner: string, cardioId?: string) => [...mock.local.values()].filter(row => row.userId === owner && (!cardioId || row.cardioId === cardioId)),
  readPendingPhoto: async (owner: string, skip: Set<string> = new Set()) => [...mock.local.values()].find(row => row.userId === owner && row.state !== 'synced' && !row.deleteAcknowledged && !skip.has(row.id)),
  readPhoto: async (id: string, owner: string) => mock.local.get(`${owner}:${id}`),
  insertPhoto: async (row: CardioPhoto) => { mock.local.set(row.key, row) },
  changePhoto: async (owner: string, id: string, update: (row: CardioPhoto | undefined) => CardioPhoto | undefined) => { const key = `${owner}:${id}`, next = update(mock.local.get(key)); if (next) mock.local.set(key, next); else mock.local.delete(key) },
}))
vi.mock('../src/lib/supabase', () => ({ supabase: {
  auth: { getUser: mock.getUser }, storage: { from: () => ({ upload: mock.upload, download: mock.download, remove: mock.remove }) },
  from: (table: string) => {
    let action = 'read', payload: Record<string, unknown> = {}, single = false
    const filters: Array<[string, unknown]> = []
    const chain = {
      select: () => chain, eq: (key: string, value: unknown) => { filters.push([key, value]); return chain },
      maybeSingle: () => { single = true; return chain }, single: () => { single = true; return chain },
      upsert: (row: Record<string, unknown>) => { action = 'insert'; payload = row; return chain },
      update: (row: Record<string, unknown>) => { action = 'update'; payload = row; return chain },
      then: (resolve: (value: unknown) => unknown) => {
        const records = table === 'cardio_facts' ? mock.parents : mock.remote
        if (action === 'insert' && !records.has(String(payload.id))) records.set(String(payload.id), { created_at: '2026-10-25T12:00:00Z', deleted_at: null, ...payload })
        const rows = [...records.values()].filter(row => filters.every(([key, value]) => row[key] === value))
        if (action === 'update') for (const row of rows) Object.assign(row, { ...payload, deleted_at: row.deleted_at ?? payload.deleted_at })
        return Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: null }))
      },
    }
    return chain
  },
} }))
const owner = '10000000-0000-4000-8000-000000000001', cardio = '20000000-0000-4000-8000-000000000002'
const parent = () => mock.parents.set(cardio, { id: cardio, user_id: owner, deleted_at: null })
const meta = (row: CardioPhoto) => ({ id: row.id, user_id: row.userId, cardio_id: row.cardioId, object_path: row.path, byte_size: row.bytes, sha256: row.sha256, created_at: row.createdAt, deleted_at: null })
async function queued(): Promise<CardioPhoto> {
  const blob = new NodeBlob(['actual-jpeg-bytes'], { type: 'image/jpeg' }) as unknown as Blob
  const id = crypto.randomUUID(), row: CardioPhoto = { key: `${owner}:${id}`, id, userId: owner, cardioId: cardio, path: `${owner}/cardio/${cardio}/${id}.jpg`, blob, bytes: blob.size, sha256: await photoDigest(blob), createdAt: '2026-10-25T12:00:00Z', state: 'upload' }
  mock.local.set(row.key, row); return row
}
beforeEach(() => {
  vi.clearAllMocks(); mock.local.clear(); mock.remote.clear(); mock.parents.clear()
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto })
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  mock.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null })
  mock.upload.mockResolvedValue({ error: null }); mock.remove.mockResolvedValue({ error: null })
})
it('waits for the durable cardio fact before uploading and acknowledges the exact immutable metadata', async () => {
  const row = await queued()
  await syncCardioPhotos(owner)
  expect(mock.upload).not.toHaveBeenCalled(); expect(mock.local.get(row.key)?.state).toBe('upload')
  parent(); await syncCardioPhotos(owner)
  expect(mock.remote.get(row.id)).toMatchObject(meta(row)); expect(mock.local.get(row.key)?.state).toBe('synced')
  expect(mock.local.get(row.key)?.blob).toBe(row.blob)
})
it('replays a lost upload response through the same path, hash and photo identity without duplicate metadata', async () => {
  const row = await queued(); parent()
  mock.upload.mockResolvedValueOnce({ error: { message: 'response lost' } }).mockResolvedValueOnce({ error: { message: 'ResourceAlreadyExists', statusCode: '409' } })
  mock.download.mockResolvedValue({ data: row.blob, error: null })
  await expect(syncCardioPhotos(owner)).rejects.toThrow('response lost')
  expect(mock.local.get(row.key)?.state).toBe('upload')
  await syncCardioPhotos(owner)
  expect(mock.upload.mock.calls.map(args => args[0])).toEqual([row.path, row.path]); expect(mock.remote.size).toBe(1)
  expect(mock.local.get(row.key)?.state).toBe('synced')
})
it('retains a different file on duplicate instead of overwriting it or reporting success', async () => {
  const row = await queued(); parent()
  mock.upload.mockResolvedValue({ error: { statusCode: '409', message: 'duplicate' } })
  mock.download.mockResolvedValue({ data: new NodeBlob(['different']), error: null })
  await expect(syncCardioPhotos(owner)).rejects.toThrow('отличается')
  expect(mock.local.get(row.key)?.blob).toBe(row.blob); expect(mock.remote.size).toBe(0)
})
it('never submits a previous account photo under another signed-in identity', async () => {
  const row = await queued(); parent(); mock.getUser.mockResolvedValue({ data: { user: { id: 'different-owner' } }, error: null })
  await expect(syncCardioPhotos(owner)).rejects.toThrow('исходный аккаунт')
  expect(mock.upload).not.toHaveBeenCalled(); expect(mock.local.get(row.key)).toEqual(row)
})
it('keeps a delete durable across metadata acknowledgement and failed object removal', async () => {
  const row = await queued(); parent(); await syncCardioPhotos(owner); await removeCardioPhoto(owner, row.id)
  mock.remove.mockResolvedValueOnce({ error: { message: 'connection lost' } }).mockResolvedValue({ error: null })
  await expect(syncCardioPhotos(owner)).rejects.toThrow('connection lost')
  expect(mock.remote.get(row.id)?.deleted_at).toBeTruthy(); expect(mock.local.get(row.key)?.state).toBe('delete')
  await loadCardioPhotos(owner, cardio)
  expect(mock.local.get(row.key)?.state).toBe('delete')
  await syncCardioPhotos(owner)
  expect(mock.local.get(row.key)).toMatchObject({ state: 'delete', deleteAcknowledged: true, blob: null }); expect(mock.remove).toHaveBeenCalledWith([row.path])
})
it('does not resurrect a server tombstone when an old pending upload is replayed', async () => {
  const row = await queued(); parent(); mock.remote.set(row.id, { ...meta(row), deleted_at: '2026-10-25T12:01:00Z' })
  await syncCardioPhotos(owner)
  expect(mock.remote.get(row.id)?.deleted_at).toBe('2026-10-25T12:01:00Z'); expect(mock.local.get(row.key)?.deleteAcknowledged).toBe(true)
})
it('recovers private metadata on another device and verifies the downloaded bytes before caching', async () => {
  const row = await queued(); mock.local.clear(); mock.remote.set(row.id, meta(row))
  await loadCardioPhotos(owner, cardio)
  expect(mock.local.get(row.key)?.blob).toBeNull()
  mock.download.mockResolvedValueOnce({ data: new NodeBlob(['incorrect']), error: null })
  await expect(cardioPhotoBlob(mock.local.get(row.key)!)).rejects.toThrow('не подтверждено')
  expect(mock.local.get(row.key)?.blob).toBeNull()
  mock.download.mockResolvedValue({ data: row.blob, error: null }); await cardioPhotoBlob(mock.local.get(row.key)!)
  expect(mock.local.get(row.key)?.blob).toBe(row.blob)
})
it('cleans photos loaded from cloud when their cardio result is deleted', async () => {
  const row = await queued(); parent(); mock.parents.get(cardio)!.deleted_at = '2026-10-25T12:02:00Z'
  mock.local.clear(); mock.remote.set(row.id, meta(row)); await deleteCardioResultPhotos(owner, cardio)
  expect(mock.remote.get(row.id)?.deleted_at).toBeTruthy(); expect(mock.local.get(row.key)).toMatchObject({ deleteAcknowledged: true, blob: null }); expect(mock.remove).toHaveBeenCalledWith([row.path])
})
