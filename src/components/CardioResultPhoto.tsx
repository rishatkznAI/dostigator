import { Camera, ImagePlus, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CARDIO_CHANGED_EVENT } from '../lib/cardio'
import { addCardioPhoto, CARDIO_PHOTO_CHANGED, cardioPhotoBlob, loadCardioPhotos, readPhotos, removeCardioPhoto, syncCardioPhotos, type CardioPhoto } from '../lib/cardio-photos'
import { BottomSheet } from './BottomSheet'
import './cardio-result-photo.css'

function usePhotoUrl(photo: CardioPhoto, enabled: boolean) {
  const { key, id, userId, cardioId, path, bytes, sha256, createdAt, state } = photo
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    let objectUrl: string | undefined
    setUrl(null)
    setError(null)
    if (enabled && state !== 'delete') void cardioPhotoBlob({ key, id, userId, cardioId, path, bytes, sha256, createdAt, state, blob: null }).then(blob => {
      if (!alive) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : 'Не удалось открыть фото.') })
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
    // The blob reader checks the current store row. Metadata cache events must
    // not restart the download or replace a live object URL.
  }, [key, id, userId, cardioId, path, bytes, sha256, createdAt, state, enabled, attempt])
  return { url, error, retry: () => setAttempt(value => value + 1) }
}

function PhotoThumbnail({ photo, number, onOpen }: { photo: CardioPhoto; number: number; onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  const [visible, setVisible] = useState(false)
  const { url, error } = usePhotoUrl(photo, visible)
  useEffect(() => {
    if (!button.current || !globalThis.IntersectionObserver) return
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '120px', threshold: .01 })
    observer.observe(button.current)
    return () => observer.disconnect()
  }, [])
  return <button ref={button} type="button" className="cardio-photo-thumbnail" aria-label={`Открыть фото ${number}`} onClick={onOpen}>
    {url ? <img src={url} alt="" loading="lazy" /> : <ImageIcon aria-hidden="true" />}
    <span>Фото {number}{error ? ' · открыть повторно' : ''}</span>
  </button>
}

function PhotoViewer({ photo, onClose }: { photo: CardioPhoto; onClose: () => void }) {
  const { url, error, retry } = usePhotoUrl(photo, true)
  return <BottomSheet title="Фото результата кардио" onClose={onClose}>
    {url ? <img className="cardio-photo-full" src={url} alt="Снимок результата кардио" /> : error ? <div className="error-card" role="alert"><p>{error}</p><button type="button" className="training-secondary" onClick={retry}>Повторить открытие фото</button></div> : <p role="status">Открываем фото…</p>}
  </BottomSheet>
}

const stateLabel = (photo: CardioPhoto) => photo.state === 'upload' ? 'На устройстве · ждёт загрузки' : photo.state === 'delete' ? 'Удаление ждёт синхронизации' : 'Фото синхронизировано'

export function CardioResultPhoto({ userId, cardioId }: { userId: string; cardioId: string }) {
  const section = useRef<HTMLElement>(null)
  const visibility = useRef(!globalThis.IntersectionObserver)
  const [visible, setVisible] = useState(() => !globalThis.IntersectionObserver)
  const [photos, setPhotos] = useState<CardioPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<CardioPhoto | null>(null)
  const [deleting, setDeleting] = useState<CardioPhoto | null>(null)
  const gallery = useRef<HTMLInputElement>(null)
  const camera = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const mounted = useRef(true)
  const readVersion = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (!section.current || !globalThis.IntersectionObserver) return
    const observer = new IntersectionObserver(entries => {
      const next = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0)
      visibility.current = next
      setVisible(next)
    }, { rootMargin: '120px', threshold: .01 })
    observer.observe(section.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => { setPhotos([]); setLoading(true); setError(null); setViewing(null); setDeleting(null) }, [userId, cardioId])
  const readLocal = useCallback(async () => {
    if (!mounted.current || !visibility.current) return
    const version = ++readVersion.current
    const records = (await readPhotos(userId, cardioId)).filter(photo => photo.userId === userId && photo.cardioId === cardioId && !photo.deleteAcknowledged).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    if (mounted.current && visibility.current && readVersion.current === version) { setPhotos(records); setLoading(false) }
  }, [userId, cardioId])
  const synchronize = useCallback(async (remote: boolean) => {
    if (!visibility.current) return
    try {
      await syncCardioPhotos(userId)
      if (remote && visibility.current) await loadCardioPhotos(userId, cardioId)
    } finally { await readLocal() }
  }, [userId, cardioId, readLocal])
  useEffect(() => {
    if (!visible) return
    let active = true
    const report = (reason: unknown) => { if (active && mounted.current) { setError(reason instanceof Error ? reason.message : 'Не удалось обновить фото.'); setLoading(false) } }
    void readLocal().catch(report)
    void synchronize(true).catch(report)
    const localChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ userId: string; cardioId: string }>).detail
      if (detail.userId === userId && detail.cardioId === cardioId) void readLocal().catch(report)
    }
    const cardioChanged = (event: Event) => {
      if ((event as CustomEvent<{ userId: string }>).detail.userId === userId) void synchronize(false).catch(report)
    }
    const online = () => { void synchronize(true).catch(report) }
    window.addEventListener(CARDIO_PHOTO_CHANGED, localChanged)
    window.addEventListener(CARDIO_CHANGED_EVENT, cardioChanged)
    window.addEventListener('online', online)
    const invalidateReads = () => { active = false; readVersion.current++ }
    return () => {
      invalidateReads()
      window.removeEventListener(CARDIO_PHOTO_CHANGED, localChanged)
      window.removeEventListener(CARDIO_CHANGED_EVENT, cardioChanged)
      window.removeEventListener('online', online)
    }
  }, [visible, userId, cardioId, readLocal, synchronize])

  const run = async (action: () => Promise<void>) => {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    setError(null)
    try { await action() } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : 'Не удалось сохранить фото. Результат кардио сохранён.') }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (!files.length) return
    void run(async () => {
      const current = (await readPhotos(userId, cardioId)).filter(photo => photo.userId === userId && photo.cardioId === cardioId && photo.state !== 'delete' && !photo.deleteAcknowledged)
      if (files.length > 3 - current.length) throw new Error(`К результату можно прикрепить до трёх фото. Сейчас можно добавить: ${Math.max(0, 3 - current.length)}.`)
      try { for (const file of files) await addCardioPhoto(userId, cardioId, file) }
      finally { await readLocal() }
      await synchronize(false)
    })
  }
  const active = photos.filter(photo => photo.state !== 'delete')
  const pending = photos.filter(photo => photo.state !== 'synced')
  return <section ref={section} className="cardio-result-photos" aria-label="Фото результата" aria-busy={working}>
    <h3>Фото результата</h3>
    <p className="entry-caption">До 3 фото дисплея или результата. Фото сохраняются отдельно от времени и настроек кардио.</p>
    {loading && <p className="entry-caption" role="status">Загружаем список фото…</p>}
    {photos.length > 0 && <ul className="cardio-photo-list">{photos.map(photo => <li className="cardio-photo-item" key={photo.id} data-state={photo.state}>
      {photo.state !== 'delete' && <PhotoThumbnail photo={photo} number={active.findIndex(item => item.id === photo.id) + 1} onOpen={() => setViewing(photo)} />}
      <p className="cardio-photo-status">{stateLabel(photo)}</p>
      {photo.state !== 'delete' && <button type="button" className="text-button cardio-photo-delete" disabled={working} aria-label={`Удалить фото ${active.findIndex(item => item.id === photo.id) + 1}`} onClick={() => setDeleting(photo)}><Trash2 size={16} aria-hidden="true" />Удалить фото</button>}
    </li>)}</ul>}
    <input ref={gallery} hidden type="file" aria-label="Фото из галереи" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple disabled={working || active.length >= 3} onChange={choose} />
    <input ref={camera} hidden type="file" aria-label="Снимок камерой" accept="image/*" capture="environment" disabled={working || active.length >= 3} onChange={choose} />
    <div className="cardio-photo-actions"><button type="button" className="training-secondary" disabled={working || loading || active.length >= 3} onClick={() => gallery.current?.click()}><ImagePlus size={18} aria-hidden="true" />Из галереи</button><button type="button" className="training-secondary" disabled={working || loading || active.length >= 3} onClick={() => camera.current?.click()}><Camera size={18} aria-hidden="true" />Снять фото</button></div>
    {working && <p className="entry-caption" role="status">Сохраняем изменения фото…</p>}
    {active.length >= 3 && <p className="entry-caption">Прикреплено 3 фото. Чтобы добавить другое, удали одно из них.</p>}
    {(pending.length > 0 || error) && <button type="button" className="text-button cardio-photo-retry" disabled={working} onClick={() => void run(() => synchronize(true))}><RefreshCw size={16} aria-hidden="true" />Повторить синхронизацию фото</button>}
    {pending.length > 0 && <p className="entry-caption">Ожидают синхронизации: {pending.length}. Локальная копия хранится до подтверждения сервера.</p>}
    {error && <p className="error-card" role="alert">{error}</p>}
    {viewing && <PhotoViewer photo={viewing} onClose={() => setViewing(null)} />}
    {deleting && <BottomSheet title="Удалить фото результата?" busy={working} onClose={() => setDeleting(null)}><p>Фото будет удалено с устройства и из облака после синхронизации. Время, настройки и сама запись кардио останутся.</p><button type="button" className="danger-button" disabled={working} onClick={() => void run(async () => { await removeCardioPhoto(userId, deleting.id); setDeleting(null); await synchronize(false) })}>Удалить это фото</button><button type="button" className="training-secondary" disabled={working} onClick={() => setDeleting(null)}>Оставить фото</button></BottomSheet>}
  </section>
}
