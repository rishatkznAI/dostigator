import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CardioJournal } from '../src/components/CardioJournal'
import { getCachedCardio, getCardioQueue, type CardioSession } from '../src/lib/cardio'
import { cardioDraftKey, loadCardioDraft } from '../src/lib/cardio-workout'
import { loadCardioDetails, saveCardioDetails } from '../src/lib/cardio-details'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { rpc } }))

const owner = 'treadmill-test-owner'
const base: CardioSession = {
  id: 'e170fa97-6915-4fd8-94bf-2fa6c88f606c', user_id: owner, kind: 'walk',
  activity_date: '2026-10-20', duration_minutes: 20, duration_seconds: 1217,
  distance_km: null, average_pulse: null, effort: null, note: '',
  created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-20T10:00:00Z',
  speed_kmh: 6.75, incline_percent: 2.25, revision: 0,
}
const mount = (photo = false) => render(<MemoryRouter><CardioJournal userId={owner} renderResultPhoto={photo ? id => <div data-testid={`photo-${id}`}>Фото результата</div> : undefined} /></MemoryRouter>)
const manual = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Уже сделал · записать время' }))
  fireEvent.change(screen.getByLabelText('Фактическое время, мин'), { target: { value: '20' } })
}
const fill = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } })
const history = () => fireEvent.click(screen.getByRole('button', { name: /История кардио ·/ }))

describe('visible treadmill facts', () => {
  let online: boolean
  beforeEach(() => {
    localStorage.clear()
    rpc.mockReset()
    online = false
    vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online)
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('offers optional speed and incline without opening details and restores comma input', () => {
    const view = mount()
    manual()
    const speed = screen.getByRole('textbox', { name: 'Скорость, км/ч' })
    const incline = screen.getByRole('textbox', { name: 'Наклон, %' })
    expect(speed).toHaveAttribute('inputmode', 'decimal')
    expect(incline).toHaveAttribute('inputmode', 'decimal')
    expect(speed.closest('[inert]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Детали занятия · необязательно' })).toHaveAttribute('aria-expanded', 'false')
    fill('Скорость, км/ч', '6,75')
    fill('Наклон, %', '-1,25')
    view.unmount()
    mount()
    expect(screen.getByLabelText('Скорость, км/ч')).toHaveValue('6,75')
    expect(screen.getByLabelText('Наклон, %')).toHaveValue('-1,25')
    expect(getCachedCardio(owner)).toEqual([])
  })

  it('records normalized numeric facts, displays them after save and reload, and edits the same result', async () => {
    const view = mount(true)
    manual()
    fill('Фактическое время, секунды', '17')
    fill('Скорость, км/ч', '6,75')
    fill('Наклон, %', '0')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    await screen.findByRole('heading', { name: 'Кардио сохранено' })
    const first = getCachedCardio(owner)[0]!
    expect(first).toMatchObject({ duration_seconds: 1217, speed_kmh: 6.75, incline_percent: 0 })
    expect(loadCardioDetails(owner, first.id)).toMatchObject({ speed: '6.75', incline: '0' })
    const saved = document.querySelector('.cardio-saved') as HTMLElement
    expect(within(saved).getByText('6,75 км/ч')).toBeInTheDocument()
    expect(within(saved).getByText('0 %')).toBeInTheDocument()
    expect(within(saved).getByTestId(`photo-${first.id}`).closest('[inert]')).toBeNull()
    view.unmount()
    const reloaded = mount(true)
    history()
    const card = reloaded.container.querySelector('.cardio-log-card') as HTMLElement
    expect(within(card).getByText('6,75 км/ч')).toBeInTheDocument()
    expect(within(card).getByText('0 %')).toBeInTheDocument()
    expect(within(card).getByTestId(`photo-${first.id}`)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Редактировать кардио/ }))
    expect(screen.getByLabelText('Скорость, км/ч')).toHaveValue('6.75')
    expect(screen.getByLabelText('Наклон, %')).toHaveValue('0')
    fill('Наклон, %', '2,25')
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить исправление' }))
    await screen.findByRole('heading', { name: 'Исправление сохранено' })
    expect(getCardioQueue(owner)).toHaveLength(1)
    expect(getCardioQueue(owner)[0]).toMatchObject({ id: first.id, speed_kmh: 6.75, incline_percent: 2.25, duration_seconds: 1217 })
  })

  it('keeps blank optional metrics as null', async () => {
    mount()
    manual()
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    await screen.findByRole('heading', { name: 'Кардио сохранено' })
    expect(getCardioQueue(owner)[0]).toMatchObject({ speed_kmh: null, incline_percent: null })
  })

  it.each([
    ['Скорость, км/ч', '6,,5'], ['Скорость, км/ч', '1e1'], ['Скорость, км/ч', '0'],
    ['Скорость, км/ч', '50,1'], ['Наклон, %', '-20,1'], ['Наклон, %', '40,1'],
  ])('rejects invalid %s=%s before writing receipts, sidecars or the queue', async (name, value) => {
    mount()
    manual()
    fill(name, value)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Дробную часть можно отделить запятой или точкой')
    expect(getCardioQueue(owner)).toEqual([])
    expect(getCachedCardio(owner)).toEqual([])
    expect(Object.keys(localStorage).filter(key => key.includes('cardio-receipt') || key.includes('cardio-details'))).toEqual([])
    expect(loadCardioDraft(owner).phase).toBe('manual')
    expect(screen.getByLabelText(name)).toHaveValue(value)
  })

  it('restores numeric pending facts without relying on a device sidecar', () => {
    localStorage.setItem(`trainlog:cardio:${owner}`, JSON.stringify([base]))
    mount()
    history()
    expect(screen.getAllByText('6,75 км/ч')).toHaveLength(2) // previous fact and history
    fireEvent.click(screen.getByRole('button', { name: /Редактировать кардио/ }))
    expect(screen.getByLabelText('Скорость, км/ч')).toHaveValue('6.75')
    expect(screen.getByLabelText('Наклон, %')).toHaveValue('2.25')
  })

  it('uses legacy device settings but never resurrects explicitly cleared server settings', () => {
    const legacy = { ...base, speed_kmh: null, incline_percent: null }
    localStorage.setItem(`trainlog:cardio:${owner}`, JSON.stringify([legacy]))
    saveCardioDetails(owner, base.id, { speed: '5.25', incline: '1.5', resistance: '' })
    const view = mount()
    history()
    fireEvent.click(screen.getByRole('button', { name: /Редактировать кардио/ }))
    expect(screen.getByLabelText('Скорость, км/ч')).toHaveValue('5.25')
    view.unmount()
    localStorage.removeItem(cardioDraftKey(owner))
    localStorage.setItem(`trainlog:cardio:${owner}`, JSON.stringify([{ ...legacy, revision: 2 }]))
    mount()
    history()
    expect(screen.queryByText('5,25 км/ч')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Редактировать кардио/ }))
    expect(screen.getByLabelText('Скорость, км/ч')).toHaveValue('')
    expect(screen.getByLabelText('Наклон, %')).toHaveValue('')
  })

  it('sends comma-entered values as numbers through the actual sync path and keeps the acknowledged facts', async () => {
    mount()
    await waitFor(() => expect(document.querySelector('.cardio-log-list')).toHaveAttribute('aria-busy', 'false'))
    manual()
    fill('Фактическое время, секунды', '17')
    fill('Скорость, км/ч', '6,75')
    fill('Наклон, %', '-1,25')
    rpc.mockImplementation(async (name: string, args: { p_id: string; p_record: Record<string, unknown> }) => {
      expect(name).toBe('cardio_apply_fact')
      return { data: { ...base, ...args.p_record, id: args.p_id, revision: 1 }, error: null }
    })
    online = true
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    await waitFor(() => expect(getCardioQueue(owner)).toEqual([]))
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc.mock.calls[0]?.[1].p_record).toMatchObject({ speed_kmh: 6.75, incline_percent: -1.25, duration_seconds: 1217 })
    expect(getCachedCardio(owner)[0]).toMatchObject({ speed_kmh: 6.75, incline_percent: -1.25, revision: 1 })
    await screen.findByText('Кардио синхронизировано с сервером')
  })
})
