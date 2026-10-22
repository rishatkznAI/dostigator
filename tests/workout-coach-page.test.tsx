import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkoutPage } from '../src/pages/WorkoutPage'
import { TrainingHistoryPage } from '../src/pages/TrainingHistoryPage'
import { getActiveDraft, getSyncQueue, saveActiveDraft } from '../src/lib/storage'
import { createWorkoutDraft } from '../src/lib/workout'
import type { PreviousResult, WorkoutTemplate } from '../src/types/training'

const template: WorkoutTemplate = { code: 'A', title: 'Программа A', sortOrder: 1, items: [1, 2].map((position) => ({ exercise: { key: `press-${position}`, name: `Жим ${position}`, muscles: [], steps: [], mistakes: [], youtube_url: null }, sortOrder: position, setCount: 3, repTarget: '8–12' })) }
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'coach-owner' } }) }))
vi.mock('../src/hooks/useTemplates', () => ({ useTemplates: () => ({ templates: [template], loading: false, error: null }) }))
vi.mock('../src/lib/trainingRepository', () => ({
  loadHistory: vi.fn().mockResolvedValue([]),
  loadExerciseLibrary: vi.fn().mockResolvedValue([]),
  loadPreviousResults: vi.fn(async () => new Map(template.items.map((item) => [item.exercise.key, { sessionId: 'old', finishedAt: '2026-10-12T10:00:00Z', exerciseKey: item.exercise.key, sets: [1, 2, 3].map((number) => ({ id: `old-${number}`, setNumber: number, weightKg: 60, reps: 10, rir: 2, done: true, isWarmup: false, completedAt: null })) } satisfies PreviousResult]))),
  syncWorkoutDraft: vi.fn().mockResolvedValue(undefined),
  deleteWorkoutSession: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../src/lib/rest-alert', () => ({ primeRestAlert: vi.fn(), notifyRestComplete: vi.fn() }))

describe('workout coach persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const draft = createWorkoutDraft(template, 'coach-owner')
    draft.readiness = { sleep: 3, energy: 3, stress: 3, discomfort: false, note: '', mode: 'normal' }
    saveActiveDraft(draft)
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('persists one-click facts, restores focus, and edits without replacing fact with a draft', async () => {
    const view = render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Жим 1, подход 1, вес кг' })).toHaveValue(60))
    expect(screen.getAllByRole('spinbutton').filter((input) => input.closest('.active-set'))).toHaveLength(2)
    expect(screen.getAllByRole('spinbutton')[0]).toHaveAttribute('aria-label', expect.stringContaining('Жим 1'))
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 1 · Жим 1' }))
    await waitFor(() => expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.done).toBe(true))
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]).toMatchObject({ weightKg: 60, reps: 10, done: true, rir: null })
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[1]).toMatchObject({ weightKg: null, reps: null, done: false, rir: null })
    expect(getActiveDraft('coach-owner')?.exercises[1]?.sets.every((set) => !set.done && set.weightKg === null)).toBe(true)
    expect(screen.getByRole('button', { name: 'Записать подход 2 · Жим 1' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 2 · Жим 1' }))
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets.filter((set) => set.done)).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Записать подход 2 · Жим 1' })).toBeEnabled(), { timeout: 2000 })
    expect(screen.getByText('Подход 1 сохранён')).toBeInTheDocument()
    expect(getActiveDraft('coach-owner')?.activeRest).toBeNull()
    view.unmount()
    render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage />} /></Routes></MemoryRouter>)
    await screen.findByRole('button', { name: 'Записать подход 2 · Жим 1' })
    fireEvent.click(screen.getByRole('button', { name: 'Подход 1 · записан · Жим 1' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Жим 1, подход 1, повторы' }), { target: { value: '8' } })
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.reps).toBe(10)
    fireEvent.click(screen.getByRole('button', { name: /Сохранить исправление/ }))
    await waitFor(() => expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.reps).toBe(8))
  })
  it('loads newer facts from another tab and prevents a stale draft from replacing them', async () => {
    render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage />} /><Route path="/training/history" element={<p>История</p>} /></Routes></MemoryRouter>)
    await screen.findByRole('button', { name: 'Записать подход 1 · Жим 1' })
    const stale = getActiveDraft('coach-owner')!
    const latest = structuredClone(stale)
    latest.updatedAt = new Date(Date.parse(stale.updatedAt) + 1000).toISOString()
    latest.exercises[0]!.sets[0] = { ...latest.exercises[0]!.sets[0]!, weightKg: 60, reps: 9, done: true, completedAt: latest.updatedAt }
    saveActiveDraft(latest)
    saveActiveDraft(stale)
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.done).toBe(true)
    fireEvent(window, new StorageEvent('storage', { key: 'trainlog:active:coach-owner' }))
    await screen.findByRole('button', { name: 'Записать подход 2 · Жим 1' })
    expect(getActiveDraft('coach-owner')?.exercises[0]?.sets[0]?.reps).toBe(9)
  })
})

describe('storage failure during fact confirmation', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('keeps the entered result on screen and does not claim a saved fact if storage rejects it', async () => {
    localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    saveActiveDraft(createWorkoutDraft(template, 'coach-owner'))
    render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Жим 1, подход 1, вес кг' })).toHaveValue(60))
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError') })
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 1 · Жим 1' }))
    expect(screen.getByText(/Подход не записан/)).toBeInTheDocument()
    expect(getActiveDraft('coach-owner')?.exercises[0].sets[0].done).toBe(false)
    expect(screen.getByRole('spinbutton', { name: 'Жим 1, подход 1, повторы' })).toHaveValue(10)
    expect(screen.queryByText('Подход 1 сохранён')).not.toBeInTheDocument()
  })
})


describe('finished workout recovery', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })
  it('opens a factual summary in history, keeps a single queued UUID and restores it after remount', async () => {
    localStorage.clear(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const draft = createWorkoutDraft(template, 'coach-owner'); saveActiveDraft(draft)
    const view = render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage />} /><Route path="/training/history" element={<TrainingHistoryPage />} /></Routes></MemoryRouter>)
    await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Жим 1, подход 1, вес кг' })).toHaveValue(60))
    fireEvent.click(screen.getByRole('button', { name: 'Записать подход 1 · Жим 1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Завершить', exact: true }))
    const save = screen.getByRole('button', { name: 'Сохранить неполную тренировку' })
    fireEvent.click(save); fireEvent.click(save)
    await screen.findByText('Тренировка завершена. Ниже — результат и изменения.')
    expect(screen.getByRole('region', { name: 'Итог силовой тренировки' })).toHaveTextContent('рабочих подходов: 1')
    expect(getSyncQueue('coach-owner')).toHaveLength(1)
    expect(getActiveDraft('coach-owner')).toBeNull()
    view.unmount()
    render(<MemoryRouter initialEntries={[`/training/history?finished=${draft.id}`]}><TrainingHistoryPage /></MemoryRouter>)
    expect(screen.getByRole('region', { name: 'Итог силовой тренировки' })).toHaveTextContent('Жим 1')
    expect(getSyncQueue('coach-owner')).toHaveLength(1)
  })
})

describe('gym flow acceptance',()=>{
  beforeEach(()=>{localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false)})
  afterEach(()=>{cleanup();vi.restoreAllMocks()})
  const open=()=>render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage/>}/><Route path="/training/history" element={<TrainingHistoryPage/>}/></Routes></MemoryRouter>)
  it('does not create a session or run a clock before explicit start; double start reuses the UUID',async()=>{
    open()
    const start=await screen.findByRole('button',{name:'Начать тренировку',exact:true})
    expect(getActiveDraft('coach-owner')).toBeNull()
    expect(document.querySelector('.workout-clock')).toBeNull()
    const before=Date.now();fireEvent.click(start);fireEvent.click(start)
    await screen.findByRole('button',{name:'Записать подход 1 · Жим 1'})
    const id=getActiveDraft('coach-owner')!.id
    expect(Date.parse(getActiveDraft('coach-owner')!.startedAt)).toBeGreaterThanOrEqual(before)
    expect(getActiveDraft('coach-owner')!.readiness).toBeNull()
    expect(getSyncQueue('coach-owner')).toHaveLength(0)
    expect(getActiveDraft('coach-owner')!.id).toBe(id)
  })
  it('automatically moves to the next exercise after the last set, with one editor and remaining-work rest',async()=>{
    const draft=createWorkoutDraft(template,'coach-owner')
    draft.exercises[0].sets.slice(0,2).forEach(set=>Object.assign(set,{weightKg:60,reps:10,done:true,completedAt:draft.startedAt}))
    saveActiveDraft(draft);localStorage.setItem('trainlog:auto-rest:coach-owner','true');open()
    await screen.findByRole('button',{name:'Записать подход 3 · Жим 1'})
    fireEvent.click(screen.getByRole('button',{name:'Записать подход 3 · Жим 1'}))
    await screen.findByRole('button',{name:'Записать подход 1 · Жим 2'})
    expect(document.querySelectorAll('.active-set')).toHaveLength(1)
    expect(getActiveDraft('coach-owner')!.activeRest).not.toBeNull()
    expect(screen.getByText('Подход 3 сохранён')).toBeInTheDocument()
  })
  it('does not start or offer rest after the last working set of the whole session',async()=>{
    const draft=createWorkoutDraft(template,'coach-owner')
    draft.exercises.forEach(exercise=>exercise.sets.forEach(set=>Object.assign(set,{weightKg:60,reps:10,done:true,completedAt:draft.startedAt})))
    Object.assign(draft.exercises[1].sets[2],{done:false,completedAt:null})
    saveActiveDraft(draft);localStorage.setItem('trainlog:auto-rest:coach-owner','true');open()
    await screen.findByRole('button',{name:'Записать подход 3 · Жим 2'})
    fireEvent.click(screen.getByRole('button',{name:'Записать подход 3 · Жим 2'}))
    expect(getActiveDraft('coach-owner')!.activeRest).toBeNull()
    expect(screen.queryByLabelText('Пропустить отдых')).not.toBeInTheDocument()
    expect(screen.getByRole('link',{name:'Перейти к кардио'})).toHaveAttribute('href','/training/cardio')
    expect(getActiveDraft('coach-owner')!.exercises.flatMap(item=>item.sets).filter(set=>set.done)).toHaveLength(6)
  })
  it('keeps a typed but unrecorded entry after remount and leaves the saved fact untouched',async()=>{
    const draft=createWorkoutDraft(template,'coach-owner');saveActiveDraft(draft)
    const view=open();await screen.findByRole('button',{name:'Записать подход 1 · Жим 1'})
    fireEvent.change(screen.getByLabelText('Жим 1, подход 1, повторы'),{target:{value:'9'}})
    view.unmount();open();await screen.findByRole('button',{name:'Записать подход 1 · Жим 1'})
    expect(screen.getByLabelText('Жим 1, подход 1, повторы')).toHaveValue(9)
    expect(getActiveDraft('coach-owner')!.exercises[0].sets[0]).toMatchObject({done:false,reps:null})
  })
})

describe('completion and timed-entry edge cases',()=>{
 beforeEach(()=>{localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false)})
 afterEach(()=>{cleanup();vi.restoreAllMocks()})
 const open=()=>render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage/>}/><Route path="/training/history" element={<TrainingHistoryPage/>}/></Routes></MemoryRouter>)
 it('records seconds without a required weight or RIR and restores the confirmed value',async()=>{
  const draft=createWorkoutDraft(template,'coach-owner');draft.exercises[0].target='30–45 сек';draft.exercises[0].exercise.key='synthetic-timed-only';saveActiveDraft(draft);open()
  const seconds=await screen.findByRole('spinbutton',{name:'Жим 1, подход 1, секунды'})
  expect(screen.queryByRole('spinbutton',{name:'Жим 1, подход 1, вес кг'})).not.toBeInTheDocument()
  fireEvent.change(seconds,{target:{value:'42'}})
  fireEvent.click(screen.getByRole('button',{name:'Записать подход 1 · Жим 1'}))
  expect(getActiveDraft('coach-owner')!.exercises[0].sets[0]).toMatchObject({done:true,reps:42,weightKg:0,rir:null})
  expect(screen.getByRole('button',{name:'Подход 1 · записан · Жим 1'})).toHaveTextContent('42 сек')
 })
 it('shows local completion immediately when server synchronization never responds',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
  const repo=await import('../src/lib/trainingRepository')
  vi.mocked(repo.syncWorkoutDraft).mockImplementationOnce(()=>new Promise(()=>undefined))
  const draft=createWorkoutDraft(template,'coach-owner');draft.exercises[0].sets[0]={...draft.exercises[0].sets[0],done:true,weightKg:60,reps:10,completedAt:draft.startedAt};saveActiveDraft(draft);open()
  await screen.findByRole('button',{name:'Записать подход 2 · Жим 1'})
  fireEvent.click(screen.getByRole('button',{name:'Завершить',exact:true}))
  fireEvent.click(screen.getByRole('button',{name:'Сохранить неполную тренировку'}))
  await screen.findByText('Тренировка завершена. Ниже — результат и изменения.')
  expect(getSyncQueue('coach-owner')).toHaveLength(1)
  expect(getActiveDraft('coach-owner')).toBeNull()
  expect(screen.getByText('Только на устройстве')).toBeInTheDocument()
 })
 it('changes the next main action to completion after saved associated cardio',async()=>{
  const {enqueueCardio}=await import('../src/lib/cardio');const {saveCardioReceipt}=await import('../src/lib/cardio-receipts')
  const draft=createWorkoutDraft(template,'coach-owner');draft.exercises.forEach(exercise=>exercise.sets.forEach(set=>Object.assign(set,{done:true,weightKg:50,reps:10,completedAt:draft.startedAt})));saveActiveDraft(draft)
  const session={id:'synthetic-linked-cardio',user_id:'coach-owner',activity_date:'2026-10-15',kind:'elliptical' as const,duration_minutes:20,distance_km:null,effort:null,average_pulse:null,note:'',created_at:draft.startedAt,updated_at:draft.startedAt}
  saveCardioReceipt('coach-owner',session,{durationSeconds:1217,workoutId:draft.id,updatedAt:session.updated_at});enqueueCardio(session);open()
  await screen.findByRole('button',{name:'Завершить тренировку',exact:true})
  expect(screen.queryByRole('button',{name:'Завершить без кардио'})).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'Завершить тренировку',exact:true}))
  fireEvent.click(screen.getByText('Упражнения и сравнение с прошлым разом'))
  expect(screen.getByRole('region',{name:'Итог силовой тренировки'})).toHaveTextContent('20 мин 17 сек')
 })
})
