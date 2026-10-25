import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardioResultPhoto } from './CardioResultPhoto'
import { CARDIO_CHANGED_EVENT } from '../lib/cardio'
import type { CardioPhoto } from '../lib/cardio-photo-store'

const api = vi.hoisted(() => ({ addCardioPhoto: vi.fn(), cardioPhotoBlob: vi.fn(), loadCardioPhotos: vi.fn(), readPhotos: vi.fn(), removeCardioPhoto: vi.fn(), syncCardioPhotos: vi.fn() }))
vi.mock('../lib/cardio-photos', () => ({ ...api, CARDIO_PHOTO_CHANGED: 'dostigator:cardio-photo-changed' }))
vi.mock('../lib/supabase', () => ({ supabase: {} }))
const owner = 'photo-ui-owner', cardioId = 'synthetic-cardio'
const photo = (id = 'photo-one', state: CardioPhoto['state'] = 'upload'): CardioPhoto => ({ key: `${owner}:${id}`, id, userId: owner, cardioId, path: `${owner}/cardio/${cardioId}/${id}.jpg`, bytes: 10, sha256: 'a'.repeat(64), blob: new Blob(['synthetic'], { type: 'image/jpeg' }), createdAt: '2026-10-25T10:00:00Z', state })
const changed = (userId = owner, id = cardioId) => window.dispatchEvent(new CustomEvent('dostigator:cardio-photo-changed', { detail: { userId, cardioId: id } }))
const ready = () => waitFor(() => expect(screen.getByRole('button', { name: 'Из галереи' })).toBeEnabled())

describe('CardioResultPhoto', () => {
  let records: CardioPhoto[]
  beforeEach(() => {
    records = []
    vi.resetAllMocks()
    api.readPhotos.mockImplementation(async () => [...records])
    api.syncCardioPhotos.mockResolvedValue(undefined)
    api.loadCardioPhotos.mockResolvedValue(undefined)
    api.cardioPhotoBlob.mockImplementation(async (value: CardioPhoto) => records.find(record => record.id === value.id)?.blob)
    api.addCardioPhoto.mockImplementation(async () => { records.push(photo()); changed() })
    api.removeCardioPhoto.mockImplementation(async (_owner: string, id: string) => { records = records.map(record => record.id === id ? { ...record, state: 'delete' } : record); changed() })
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:synthetic-photo') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('defers all reads and listeners until visible and scopes reads to this result', async () => {
    let visibilityChanged!: (entries: IntersectionObserverEntry[]) => void
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: (entries: IntersectionObserverEntry[]) => void) { visibilityChanged = callback }
      observe() {}
      disconnect = disconnect
    })
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    const hidden = [{ isIntersecting: false, intersectionRatio: 0 }] as IntersectionObserverEntry[]
    const shown = [{ isIntersecting: true, intersectionRatio: 1 }] as IntersectionObserverEntry[]
    act(() => { visibilityChanged(hidden); window.dispatchEvent(new Event('online')); changed() })
    expect(api.readPhotos).not.toHaveBeenCalled()
    expect(api.loadCardioPhotos).not.toHaveBeenCalled()
    expect(api.syncCardioPhotos).not.toHaveBeenCalled()
    act(() => visibilityChanged(shown))
    await ready()
    expect(api.loadCardioPhotos).toHaveBeenCalledWith(owner, cardioId)
    expect(api.readPhotos.mock.calls.every(call => call[0] === owner && call[1] === cardioId)).toBe(true)
    const reads = api.readPhotos.mock.calls.length
    act(() => visibilityChanged(hidden))
    act(() => { window.dispatchEvent(new Event('online')); changed() })
    expect(api.loadCardioPhotos).toHaveBeenCalledTimes(1)
    expect(api.readPhotos).toHaveBeenCalledTimes(reads)
  })

  it('provides gallery and optional camera after save and persists before starting sync', async () => {
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    expect(screen.getByLabelText('Снимок камерой')).toHaveAttribute('capture', 'environment')
    const file = new File(['synthetic'], 'treadmill.jpg', { type: 'image/jpeg' })
    fireEvent.change(screen.getByLabelText('Фото из галереи'), { target: { files: [file] } })
    await screen.findByText('На устройстве · ждёт загрузки')
    expect(api.addCardioPhoto).toHaveBeenCalledWith(owner, cardioId, file)
    await waitFor(() => expect(api.syncCardioPhotos).toHaveBeenCalledTimes(2))
    expect(api.addCardioPhoto.mock.invocationCallOrder[0]).toBeLessThan(api.syncCardioPhotos.mock.invocationCallOrder[1]!)
    expect(screen.getByText('Ожидают синхронизации: 1. Локальная копия хранится до подтверждения сервера.')).toBeInTheDocument()
  })

  it('reads local changes without a metadata fetch loop and ignores other owners or cardio results', async () => {
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    expect(api.loadCardioPhotos).toHaveBeenCalledTimes(1)
    const reads = api.readPhotos.mock.calls.length
    changed('someone-else'); changed(owner, 'other-cardio')
    expect(api.readPhotos).toHaveBeenCalledTimes(reads)
    records.push(photo())
    changed()
    await screen.findByRole('button', { name: 'Открыть фото 1' })
    expect(api.loadCardioPhotos).toHaveBeenCalledTimes(1)
    expect(api.syncCardioPhotos).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new CustomEvent(CARDIO_CHANGED_EVENT, { detail: { userId: owner } }))
    await waitFor(() => expect(api.syncCardioPhotos).toHaveBeenCalledTimes(2))
    expect(api.loadCardioPhotos).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(api.loadCardioPhotos).toHaveBeenCalledTimes(2))
  })

  it('loads a private preview on demand and revokes its blob URL on close', async () => {
    records = [photo('synced', 'synced')]
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    expect(api.cardioPhotoBlob).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Фото результата кардио' })
    expect(await within(dialog).findByAltText('Снимок результата кардио')).toHaveAttribute('src', 'blob:synthetic-photo')
    expect(api.cardioPhotoBlob).toHaveBeenCalledOnce()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-photo'))
  })

  it('asks before deletion, allows cancellation, and keeps an offline tombstone visible', async () => {
    records = [photo()]
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить фото 1' }))
    let dialog = screen.getByRole('dialog', { name: 'Удалить фото результата?' })
    expect(api.removeCardioPhoto).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Оставить фото' }))
    expect(api.removeCardioPhoto).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить фото 1' }))
    dialog = screen.getByRole('dialog', { name: 'Удалить фото результата?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Удалить это фото' }))
    await screen.findByText('Удаление ждёт синхронизации')
    expect(api.removeCardioPhoto).toHaveBeenCalledWith(owner, 'photo-one')
    expect(screen.queryByRole('button', { name: 'Открыть фото 1' })).not.toBeInTheDocument()
    expect(records[0]!.blob).not.toBeNull()
  })

  it('limits selection to three and keeps owner filtering even if the store returns unrelated rows', async () => {
    records = [photo('one'), photo('two'), photo('three'), { ...photo('other'), userId: 'other-owner' }]
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await waitFor(() => expect(screen.queryByText('Загружаем список фото…')).not.toBeInTheDocument())
    expect(screen.getAllByRole('button', { name: /Открыть фото/ })).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Из галереи' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Снять фото' })).toBeDisabled()
  })

  it('rejects a selection larger than the remaining capacity before persisting any file', async () => {
    records = [photo()]
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    const files = [1, 2, 3].map(number => new File(['synthetic'], `result-${number}.jpg`, { type: 'image/jpeg' }))
    fireEvent.change(screen.getByLabelText('Фото из галереи'), { target: { files } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Сейчас можно добавить: 2')
    expect(api.addCardioPhoto).not.toHaveBeenCalled()
    expect(records).toHaveLength(1)
  })

  it('hides an acknowledged deletion marker from gallery and pending status', async () => {
    records = [{ ...photo('deleted', 'delete'), deleteAcknowledged: true, blob: null }]
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    expect(screen.queryByText('Удаление ждёт синхронизации')).not.toBeInTheDocument()
    expect(screen.queryByText(/Ожидают синхронизации:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Повторить синхронизацию фото' })).not.toBeInTheDocument()
  })

  it('does not create an object URL if an in-flight preview finishes after unmount', async () => {
    records = [photo()]
    let finish!: (blob: Blob) => void
    api.cardioPhotoBlob.mockImplementationOnce(() => new Promise<Blob>(resolve => { finish = resolve }))
    const view = render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть фото 1' }))
    await waitFor(() => expect(api.cardioPhotoBlob).toHaveBeenCalledOnce())
    view.unmount()
    finish(records[0]!.blob!)
    await Promise.resolve()
    expect(URL.createObjectURL).not.toHaveBeenCalled()
  })

  it('keeps local photo on sync failure, reports it separately and retries manually', async () => {
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    api.syncCardioPhotos.mockRejectedValueOnce(new Error('Сеть недоступна для фото'))
    fireEvent.change(screen.getByLabelText('Фото из галереи'), { target: { files: [new File(['synthetic'], 'result.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Сеть недоступна для фото')
    expect(records).toHaveLength(1)
    expect(records[0]!.state).toBe('upload')
    api.syncCardioPhotos.mockImplementationOnce(async () => { records = records.map(record => ({ ...record, state: 'synced' })); changed() })
    fireEvent.click(screen.getByRole('button', { name: 'Повторить синхронизацию фото' }))
    await screen.findByText('Фото синхронизировано')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not announce a photo saved when decoding or local persistence fails', async () => {
    render(<CardioResultPhoto userId={owner} cardioId={cardioId} />)
    await ready()
    api.addCardioPhoto.mockRejectedValueOnce(new Error('Не удалось прочитать снимок'))
    fireEvent.change(screen.getByLabelText('Фото из галереи'), { target: { files: [new File(['invalid'], 'bad.jpg', { type: 'image/jpeg' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось прочитать снимок')
    expect(screen.queryByText('На устройстве · ждёт загрузки')).not.toBeInTheDocument()
    expect(api.syncCardioPhotos).toHaveBeenCalledTimes(1)
  })
})
