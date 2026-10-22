import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CardioJournal } from '../src/components/CardioJournal'
import { getCachedCardio, getCardioQueue } from '../src/lib/cardio'
import * as cardioModule from '../src/lib/cardio'
import { cardioDraftKey, changeCardioTimer, newCardioDraft } from '../src/lib/cardio-workout'

vi.mock('../src/lib/supabase', () => ({ supabase: { from: vi.fn() } }))
const openManual = () => fireEvent.click(screen.getByRole('button', { name: 'Уже сделал · записать время' }))

describe('cardio recording', () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); Element.prototype.scrollIntoView = vi.fn() })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('saves only actual time without any questionnaire and remains idempotent', async () => {
    const view = render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    openManual()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Фактическое время, мин'), { target: { value: '25' } })
    const submit = screen.getByRole('button', { name: 'Сохранить кардио' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    await waitFor(() => expect(getCachedCardio('owner')).toHaveLength(1))
    expect(getCachedCardio('owner')[0]).toMatchObject({ duration_minutes: 25, effort: null, average_pulse: null, note: '' })
    expect(screen.getByRole('status')).toHaveTextContent('На устройстве')
    const id = getCachedCardio('owner')[0]!.id
    view.unmount()
    render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Кардио сохранено' })).toBeInTheDocument()
    fireEvent.click(screen.getByText('История кардио · 1'))
    fireEvent.click(screen.getByRole('button', { name: /Редактировать кардио/ }))
    fireEvent.change(screen.getByLabelText('Фактическое время, мин'), { target: { value: '20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить исправление' }))
    await waitFor(() => expect(getCachedCardio('owner')[0]?.duration_minutes).toBe(20))
    expect(getCardioQueue('owner')).toHaveLength(1)
    expect(getCardioQueue('owner')[0]?.id).toBe(id)
  })
  it('keeps a queued saved result on a sync failure without reporting a false other-tab conflict',async()=>{
    render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    openManual()
    fireEvent.change(screen.getByLabelText('Фактическое время, мин'),{target:{value:'20'}})
    vi.spyOn(cardioModule,'syncCardio').mockRejectedValue(new Error('Test network unavailable'))
    fireEvent.click(screen.getByRole('button',{name:'Сохранить кардио'}))
    await screen.findByText(/Test network unavailable/)
    expect(screen.getByRole('heading',{name:'Кардио сохранено'})).toBeInTheDocument()
    expect(screen.queryByText(/Черновик обновился в другой вкладке/)).not.toBeInTheDocument()
    expect(getCardioQueue('owner')).toHaveLength(1)
  })
  it('opens a fresh optional C cardio plan after a saved B result without altering that fact',()=>{
    const prior={...newCardioDraft('owner'),phase:'saved',minutes:'20',seconds:'17',goalMinutes:20,workoutId:'previous-B'}
    localStorage.setItem(cardioDraftKey('owner'),JSON.stringify(prior))
    render(<MemoryRouter initialEntries={['/training/cardio?program=C']}><CardioJournal userId="owner"/></MemoryRouter>)
    expect(screen.getByRole('button',{name:'Запустить таймер'})).toBeInTheDocument()
    expect(screen.getByText(/C · по желанию: 30–45 минут/)).toBeInTheDocument()
    expect(screen.getByText('30 мин')).toBeInTheDocument()
    expect(screen.queryByRole('heading',{name:'Кардио сохранено'})).not.toBeInTheDocument()
  })
  it('restores an unfinished manual entry and hides irrelevant metrics for an elliptical', () => {
    const view = render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('Вид кардио'), { target: { value: 'elliptical' } })
    openManual()
    fireEvent.change(screen.getByLabelText('Фактическое время, мин'), { target: { value: '17' } })
    expect(screen.getByLabelText('Дистанция, км')).toBeInTheDocument()
    expect(screen.getByLabelText('Уровень сопротивления')).toBeInTheDocument()
    expect(screen.queryByLabelText('Скорость, км/ч')).not.toBeInTheDocument()
    view.unmount()
    render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    expect(screen.getByLabelText('Фактическое время, мин')).toHaveValue(17)
    expect(getCachedCardio('owner')).toHaveLength(0)
  })
  it('shows elapsed timer time separately from whole-minute history before confirmation', async () => {
    const running = changeCardioTimer(newCardioDraft('owner'), 'start', Date.now() - 90_000)
    localStorage.setItem(cardioDraftKey('owner'), JSON.stringify(running))
    render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    expect(screen.getByLabelText('Таймер кардио')).toHaveTextContent('01:30')
    fireEvent.click(screen.getByRole('button', { name: 'Завершить кардио' }))
    expect(screen.getByLabelText('Фактическое время, мин')).toHaveValue(1)
    expect(getCachedCardio('owner')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    await waitFor(() => expect(getCachedCardio('owner')[0]?.duration_minutes).toBe(1))
  })
})

describe('reset confirmation inside the app', () => {
  beforeEach(() => { localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false) })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('cancels or clears only unsaved input and preserves the saved 25-minute history', async () => {
    render(<MemoryRouter><CardioJournal userId="owner" /></MemoryRouter>)
    openManual(); fireEvent.change(screen.getByLabelText('Фактическое время, мин'), { target: { value: '25' } }); fireEvent.click(screen.getByRole('button', { name: 'Сохранить кардио' }))
    await screen.findByRole('heading', { name: 'Кардио сохранено' })
    fireEvent.click(screen.getByRole('button', { name: 'Новое кардио' }))
    openManual(); fireEvent.change(screen.getByLabelText('Фактическое время, мин'), { target: { value: '17' } })
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить несохранённый ввод' }))
    expect(screen.getByRole('dialog', { name: 'Сбросить несохранённый ввод?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Продолжить ввод' }))
    expect(screen.getByLabelText('Фактическое время, мин')).toHaveValue(17)
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить несохранённый ввод' })); fireEvent.click(screen.getByRole('button', { name: 'Сбросить только ввод' }))
    expect(screen.getByRole('button', { name: 'Запустить таймер' })).toBeInTheDocument()
    expect(getCachedCardio('owner')).toHaveLength(1)
    expect(getCachedCardio('owner')[0].duration_minutes).toBe(25)
  })
})

it('keeps the A/B cardio plan at 20 minutes even when the last activity lasted 25',async()=>{
 localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false)
 const {createWorkoutDraft}=await import('../src/lib/workout');const {saveActiveDraft}=await import('../src/lib/storage')
 saveActiveDraft(createWorkoutDraft({code:'B',title:'Synthetic B',sortOrder:2,items:[]},'owner'))
 localStorage.setItem('trainlog:cardio:owner',JSON.stringify([{id:'older',user_id:'owner',kind:'walk',activity_date:'2026-10-15',duration_minutes:25,created_at:'2026-10-15T09:00:00Z',updated_at:'2026-10-15T09:00:00Z',note:'',distance_km:null,average_pulse:null,effort:null}]))
 const {container}=render(<MemoryRouter><CardioJournal userId="owner"/></MemoryRouter>)
 expect(container.querySelector('.training-comparison > div:first-child')).toHaveTextContent('25 мин');expect(container.querySelector('.training-comparison > div:last-child')).toHaveTextContent('20 мин')
 expect(screen.getByText('План этого тренировочного дня — 20 минут. Прошлая запись не меняет его.')).toBeInTheDocument()
 cleanup();vi.restoreAllMocks()
})
