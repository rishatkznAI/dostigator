export type CardioPhoto = {
  key: string; id: string; userId: string; cardioId: string; path: string;
  bytes: number; sha256: string; createdAt: string; blob: Blob | null;
  state: 'upload' | 'synced' | 'delete'; deleteAcknowledged?: boolean;
}
type StoredPhoto = Omit<CardioPhoto, 'blob'> & { imageBytes?: ArrayBuffer | null; blob?: Blob | null; storageVersion?: string }
export const CARDIO_PHOTO_CHANGED = 'dostigator:cardio-photo-changed'
export const photoKey = (owner: string, id: string) => `${owner}:${id}`
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Браузер не разрешил хранение фото на устройстве.')); return }
    const request = indexedDB.open('dostigator-cardio-photos', 2)
    request.onupgradeneeded = () => {
      const store = request.result.objectStoreNames.contains('photos')
        ? request.transaction!.objectStore('photos')
        : request.result.createObjectStore('photos', { keyPath: 'key' })
      if (!store.indexNames.contains('owner')) store.createIndex('owner', 'userId')
      if (!store.indexNames.contains('ownerCardio')) store.createIndex('ownerCardio', ['userId', 'cardioId'])
      if (!store.indexNames.contains('ownerState')) store.createIndex('ownerState', ['userId', 'state'])
    }
    request.onerror = () => reject(new Error('Не удалось открыть хранилище фото.'))
    request.onsuccess = () => resolve(request.result)
  })
}
function notify(photo: CardioPhoto) { window.dispatchEvent(new CustomEvent(CARDIO_PHOTO_CHANGED, { detail: { userId: photo.userId, cardioId: photo.cardioId } })) }
// WebKit can decode a camera Blob but fail to clone its backing file into IDB.
// Persist bytes instead. Legacy Blob rows remain readable without a destructive
// database upgrade or clearing the user's existing images.
const decode = (row: StoredPhoto): CardioPhoto => {
  const { imageBytes, storageVersion: _version, ...rest } = row
  return { ...rest, blob: imageBytes ? new Blob([imageBytes], { type: 'image/jpeg' }) : row.blob ?? null }
}
const encode = async (photo: CardioPhoto): Promise<StoredPhoto> => ({ ...photo, blob: null, imageBytes: photo.blob ? await photo.blob.arrayBuffer() : null, storageVersion: crypto.randomUUID() })
async function readRaw(id: string, owner: string): Promise<StoredPhoto | undefined> {
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos'), request = tx.objectStore('photos').get(photoKey(owner, id))
    tx.oncomplete = () => { db.close(); resolve(request.result?.userId === owner ? request.result : undefined) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Не удалось прочитать фото на устройстве.')) }
  })
}
export async function readPhoto(id: string, owner: string): Promise<CardioPhoto | undefined> {
  const row = await readRaw(id, owner); return row ? decode(row) : undefined
}
export async function readPhotos(owner: string, cardioId?: string): Promise<CardioPhoto[]> {
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos'), store = tx.objectStore('photos')
    const request = cardioId === undefined ? store.index('owner').getAll(owner) : store.index('ownerCardio').getAll([owner, cardioId])
    tx.oncomplete = () => { db.close(); resolve((request.result as StoredPhoto[]).filter(row => row.userId === owner && (cardioId === undefined || row.cardioId === cardioId)).map(decode)) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Не удалось прочитать список фото.')) }
  })
}
/** Read one queued image, without loading any synced JPEG buffers. */
export async function readPendingPhoto(owner: string, skipIds: Set<string> = new Set()): Promise<CardioPhoto | undefined> {
  const db = await openStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos'), index = tx.objectStore('photos').index('ownerState')
    let found: StoredPhoto | undefined
    const readState = (state: 'delete' | 'upload') => {
      const request = index.openCursor(IDBKeyRange.only([owner, state]))
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) { if (state === 'delete') readState('upload'); return }
        const id = String(cursor.primaryKey).slice(owner.length + 1)
        if (skipIds.has(id)) { cursor.continue(); return }
        const row = cursor.value as StoredPhoto
        if (row.userId !== owner || row.state !== state || row.deleteAcknowledged || skipIds.has(row.id)) { cursor.continue(); return }
        found = row
      }
    }
    readState('delete')
    tx.oncomplete = () => { db.close(); resolve(found ? decode(found) : undefined) }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Не удалось прочитать очередь фото на устройстве.')) }
  })
}
export async function insertPhoto(photo: CardioPhoto): Promise<void> {
  const stored = await encode(photo), db = await openStore()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readwrite'), store = tx.objectStore('photos')
    const request = store.index('ownerCardio').getAll([photo.userId, photo.cardioId])
    let reason = 'Фото не сохранилось на устройстве. Возможно, закончилось свободное место.'
    request.onsuccess = () => {
      if ((request.result as StoredPhoto[]).filter(row => row.cardioId === photo.cardioId && row.state !== 'delete').length >= 3) {
        reason = 'К одному результату можно прикрепить до трёх фото.'; tx.abort(); return
      }
      store.add(stored)
    }
    tx.oncomplete = () => { db.close(); notify(photo); resolve() }
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error(reason)) }
  })
}
// Bytes must be prepared before opening a write transaction (awaiting Blob IO
// inside it would let WebKit auto-commit). CAS rechecks the snapshot atomically
// so this preparation cannot overwrite a concurrent delete or upload receipt.
export async function changePhoto(owner: string, id: string, update: (current: CardioPhoto | undefined) => CardioPhoto | undefined): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const before = await readRaw(id, owner), next = update(before ? decode(before) : undefined)
    const stored = next ? await encode(next) : undefined, db = await openStore()
    const accepted = await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction('photos', 'readwrite'), store = tx.objectStore('photos'), request = store.get(photoKey(owner, id))
      let matches = false
      request.onsuccess = () => {
        const current = request.result as StoredPhoto | undefined
        matches = Boolean(current) === Boolean(before) && current?.storageVersion === before?.storageVersion
        if (!matches) return
        if (stored) store.put(stored); else store.delete(photoKey(owner, id))
      }
      tx.oncomplete = () => { db.close(); resolve(matches) }
      tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Фото не сохранилось на устройстве. Возможно, закончилось свободное место.')) }
    })
    if (accepted) { if (next ?? before) notify(next ?? decode(before!)); return }
  }
  throw new Error('Фото изменилось в другой вкладке. Повтори действие.')
}
