import { supabase } from './supabase'
import { changePhoto, insertPhoto, photoKey, readPendingPhoto, readPhoto, readPhotos, type CardioPhoto } from './cardio-photo-store'
export { CARDIO_PHOTO_CHANGED, readPendingPhoto, readPhotos } from './cardio-photo-store'
export type { CardioPhoto } from './cardio-photo-store'
const bucket = 'trainlog-progress-photos'
export const CARDIO_PHOTO_MAX_BYTES = 2 * 1024 * 1024
const columns = 'id,user_id,cardio_id,object_path,byte_size,sha256,created_at,deleted_at'
const fail = (error: { message: string } | null) => { if (error) throw new Error(error.message) }
async function assertOwner(owner: string) {
  const result = await supabase.auth.getUser()
  if (result.error || result.data.user?.id !== owner) throw new Error('Вход в аккаунт не подтверждён. Фото сохранено на устройстве; войди в исходный аккаунт и повтори.')
}
export async function photoDigest(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(value => value.toString(16).padStart(2, '0')).join('')
}
// Redrawing removes EXIF/location metadata and keeps large camera files out of
// localStorage. Decode failure never replaces an existing result or photo.
export async function prepareCardioPhoto(file: File): Promise<Blob> {
  if (!file.size || file.size > 20 * 1024 * 1024) throw new Error('Выбери фото размером до 20 МБ.')
  if (file.type && !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type)) throw new Error('Выбери фото JPEG, PNG, WebP или снимок камеры.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    try { await image.decode() } catch { throw new Error('Не удалось прочитать снимок. Попробуй фото JPEG, PNG или WebP.') }
    const scale = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Браузер не смог подготовить фото.')
    context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const encode = (quality: number) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Не удалось подготовить фото.')), 'image/jpeg', quality))
    let blob = await encode(.88)
    if (blob.size > CARDIO_PHOTO_MAX_BYTES) blob = await encode(.7)
    if (blob.size > CARDIO_PHOTO_MAX_BYTES) throw new Error('Снимок получился слишком большим. Выбери фото меньшего размера.')
    return blob
  } finally { URL.revokeObjectURL(url) }
}
export async function addCardioPhoto(owner: string, cardioId: string, file: File): Promise<void> {
  if ((await readPhotos(owner, cardioId)).filter(row => row.cardioId === cardioId && row.state !== 'delete').length >= 3) throw new Error('К одному результату можно прикрепить до трёх фото.')
  const blob = await prepareCardioPhoto(file), id = crypto.randomUUID()
  const row: CardioPhoto = { key: photoKey(owner, id), id, userId: owner, cardioId, path: `${owner}/cardio/${cardioId}/${id}.jpg`, blob, bytes: blob.size, sha256: await photoDigest(blob), createdAt: new Date().toISOString(), state: 'upload' }
  await insertPhoto(row)
}
export async function removeCardioPhoto(owner: string, id: string) {
  await changePhoto(owner, id, current => current ? { ...current, state: 'delete' } : undefined)
}
export async function deleteCardioResultPhotos(owner: string, cardioId: string) {
  const remote = await queryCardioPhotos(owner, cardioId)
  // Cardio deletion must also work in browsers that never allowed photo storage.
  // An inaccessible local image stays isolated; the next successful queue read
  // sees the parent's tombstone and deletes it instead of uploading it.
  const local = await readPhotos(owner, cardioId).catch(() => [])
  const photos = new Map(local.filter(row => row.cardioId === cardioId).map(row => [row.id, row]))
  for (const row of remote) if (!photos.has(row.id)) photos.set(row.id, { key: photoKey(owner, row.id), id: row.id, userId: owner, cardioId, path: row.object_path, bytes: row.byte_size, sha256: row.sha256, createdAt: row.created_at, blob: null, state: 'delete' })
  for (const photo of photos.values()) await changePhoto(owner, photo.id, current => ({ ...(current ?? photo), state: 'delete', deleteAcknowledged: false }))
  for (const photo of photos.values()) {
    await tombstonePhoto(photo)
    await changePhoto(owner, photo.id, current => ({ ...(current ?? photo), state: 'delete', blob: null, deleteAcknowledged: true }))
  }
}
const metadata = (photo: CardioPhoto) => ({ id: photo.id, user_id: photo.userId, cardio_id: photo.cardioId, object_path: photo.path, byte_size: photo.bytes, sha256: photo.sha256 })
const isMatching = (photo: CardioPhoto, row: Record<string, unknown>) => Object.entries(metadata(photo)).every(([key, value]) => row[key] === value)
async function queryCardioPhotos(owner: string, cardioId: string) {
  await assertOwner(owner)
  const result = await supabase.from('cardio_result_photos').select(columns).eq('user_id', owner).eq('cardio_id', cardioId)
  fail(result.error)
  for (const row of result.data ?? []) {
    if (row.user_id !== owner || row.cardio_id !== cardioId || row.object_path !== `${owner}/cardio/${cardioId}/${row.id}.jpg` || !/^[a-f0-9]{64}$/.test(row.sha256) || row.byte_size < 1 || row.byte_size > CARDIO_PHOTO_MAX_BYTES) throw new Error('Получен некорректный список фото.')
  }
  return result.data ?? []
}
export async function loadCardioPhotos(owner: string, cardioId: string): Promise<void> {
  if (!navigator.onLine) return
  for (const row of await queryCardioPhotos(owner, cardioId)) {
    await changePhoto(owner, row.id, current => row.deleted_at ? current ? { ...current, state: 'delete' } : { key: photoKey(owner, row.id), id: row.id, userId: owner, cardioId, path: row.object_path, bytes: row.byte_size, sha256: row.sha256, createdAt: row.created_at, blob: null, state: 'delete' } : current?.state === 'upload' || current?.state === 'delete' ? current : { key: photoKey(owner, row.id), id: row.id, userId: owner, cardioId, path: row.object_path, bytes: row.byte_size, sha256: row.sha256, createdAt: row.created_at, state: 'synced', blob: current?.blob ?? null })
  }
}
async function tombstonePhoto(photo: CardioPhoto) {
  const stamp = new Date().toISOString(), owner = photo.userId
  fail((await supabase.from('cardio_result_photos').upsert({ ...metadata(photo), deleted_at: stamp }, { onConflict: 'id', ignoreDuplicates: true })).error)
  const removed = await supabase.from('cardio_result_photos').update({ deleted_at: stamp }).eq('id', photo.id).eq('user_id', owner).select(columns).single()
  fail(removed.error)
  if (!removed.data?.deleted_at || !isMatching(photo, removed.data)) throw new Error('Сервер не подтвердил удаление фото.')
  fail((await supabase.storage.from(bucket).remove([photo.path])).error)
}
export async function cardioPhotoBlob(photo: CardioPhoto): Promise<Blob> {
  const current = await readPhoto(photo.id, photo.userId)
  if (!current || current.state === 'delete') throw new Error('Фото удалено.')
  if (current.blob) return current.blob
  if (!navigator.onLine) throw new Error('Для первого открытия этого фото подключись к сети.')
  await assertOwner(photo.userId)
  const result = await supabase.storage.from(bucket).download(photo.path)
  fail(result.error)
  if (!result.data || result.data.size !== photo.bytes || await photoDigest(result.data) !== photo.sha256) throw new Error('Содержимое фото не подтверждено. Повтори загрузку.')
  await changePhoto(photo.userId, photo.id, row => row && row.state !== 'delete' ? { ...row, blob: result.data } : row)
  return result.data
}
const syncing = new Map<string, Promise<void>>()
export function syncCardioPhotos(owner: string): Promise<void> {
  const active = syncing.get(owner); if (active) return active
  const run = async () => {
    if (!navigator.onLine) return
    const waiting = new Set<string>()
    while (navigator.onLine) {
      const photo = await readPendingPhoto(owner, waiting)
      if (!photo) return
      await assertOwner(owner)
      const parent = await supabase.from('cardio_facts').select('id,user_id,deleted_at').eq('id', photo.cardioId).eq('user_id', owner).maybeSingle()
      fail(parent.error)
      if (!parent.data) { waiting.add(photo.id); continue }
      if (parent.data.deleted_at && photo.state === 'upload') { await removeCardioPhoto(owner, photo.id); continue }
      if (photo.state === 'delete') {
        // Keep a server tombstone so an upload retried by another tab cannot
        // resurrect a deliberately removed photo after a lost response.
        await tombstonePhoto(photo)
        await changePhoto(owner, photo.id, current => current?.state === 'delete' ? { ...current, blob: null, deleteAcknowledged: true } : current)
        continue
      }
      if (!photo.blob) throw new Error('Локальная копия фото недоступна. Результат кардио сохранён.')
      const upload = await supabase.storage.from(bucket).upload(photo.path, photo.blob, { contentType: 'image/jpeg', cacheControl: '60', upsert: false })
      if (upload.error) {
        if (String(upload.error.statusCode) !== '409' && upload.error.message !== 'The resource already exists') fail(upload.error)
        const existing = await supabase.storage.from(bucket).download(photo.path); fail(existing.error)
        if (!existing.data || await photoDigest(existing.data) !== photo.sha256) throw new Error('Облачный файл отличается. Локальное фото сохранено; повтори позже.')
      }
      const latest = await readPhoto(photo.id, owner)
      if (!latest || latest.state === 'delete') {
        if (!latest || latest.deleteAcknowledged) await changePhoto(owner, photo.id, current => ({ ...(current ?? photo), state: 'delete', deleteAcknowledged: false }))
        continue
      }
      fail((await supabase.from('cardio_result_photos').upsert(metadata(photo), { onConflict: 'id', ignoreDuplicates: true })).error)
      const confirmed = await supabase.from('cardio_result_photos').select(columns).eq('id', photo.id).eq('user_id', owner).single()
      fail(confirmed.error)
      if (!confirmed.data || !isMatching(photo, confirmed.data)) throw new Error('Сервер не подтвердил фото. Копия на устройстве сохранена.')
      if (confirmed.data.deleted_at) { await removeCardioPhoto(owner, photo.id); continue }
      await changePhoto(owner, photo.id, current => current?.state === 'upload' ? { ...current, state: 'synced', createdAt: confirmed.data!.created_at } : current)
    }
  }
  const promise = run().finally(() => syncing.delete(owner)); syncing.set(owner, promise); return promise
}
