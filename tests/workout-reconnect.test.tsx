import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { WorkoutPage } from '../src/pages/WorkoutPage'
import { createWorkoutDraft } from '../src/lib/workout'
import { getActiveDraft, saveActiveDraft } from '../src/lib/storage'
import { programV21Templates } from '../src/lib/program-v21'
const {sync,cancel}=vi.hoisted(()=>({sync:vi.fn(),cancel:vi.fn()}))
vi.mock('../src/context/AuthContext',()=>({useAuth:()=>({user:{id:'reconnect-owner'}})}))
vi.mock('../src/hooks/useTemplates',()=>({useTemplates:()=>({templates:programV21Templates,loading:false,error:null})}))
vi.mock('../src/lib/trainingRepository',()=>({loadHistory:async()=>[],loadExerciseLibrary:async()=>[],loadPreviousResults:async()=>new Map(),syncWorkoutDraft:sync,deleteWorkoutSession:cancel}))
let online=false
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();online=false;vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);sync.mockResolvedValue(undefined);cancel.mockResolvedValue(undefined);saveActiveDraft(createWorkoutDraft(programV21Templates[0],'reconnect-owner'))})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const mount=()=>render(<MemoryRouter initialEntries={['/training/workout/A']}><Routes><Route path="/training/workout/:code" element={<WorkoutPage/>}/><Route path="/training" element={<p>Тренировки</p>}/></Routes></MemoryRouter>)
it('retries an unchanged active draft after the network returns',async()=>{
 mount();await screen.findByText('Офлайн · сохранено на устройстве');expect(sync).not.toHaveBeenCalled()
 online=true;fireEvent(window,new Event('online'))
 await waitFor(()=>expect(sync).toHaveBeenCalledOnce(),{timeout:2000});await screen.findByText('Сохранено в облаке')
 expect(getActiveDraft('reconnect-owner')).not.toBeNull()
})
it('does not claim cloud success after a rejected save, and a manual retry succeeds',async()=>{
 online=true;sync.mockRejectedValueOnce(new Error('Сервер ещё не обновлён для V2.1.'))
 mount();await screen.findByText('Сервер ещё не обновлён для V2.1.',{exact:true},{timeout:2000});expect(screen.queryByText('Сохранено в облаке')).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'Повторить синхронизацию'}));await screen.findByText('Сохранено в облаке',{}, {timeout:2000})
 expect(sync).toHaveBeenCalledTimes(2)
})
it('opens a truthful incomplete confirmation even before the first set',async()=>{
 mount();await screen.findByRole('button',{name:'Завершить'});fireEvent.click(screen.getByRole('button',{name:'Завершить'}))
 expect(screen.getByText(/Не завершено рабочих подходов: 15/)).toBeInTheDocument();expect(getActiveDraft('reconnect-owner')).not.toBeNull()
})
it('preserves the full draft when online cancellation fails',async()=>{
 online=true;cancel.mockRejectedValue(new Error('Сервер ещё не обновлён для V2.1.'));const before=getActiveDraft('reconnect-owner')!;mount()
 fireEvent.click(await screen.findByRole('button',{name:'Отменить тренировку',exact:true}));fireEvent.click(screen.getAllByRole('button',{name:'Отменить тренировку',exact:true}).at(-1)!)
 await screen.findByText('Сервер ещё не обновлён для V2.1.',{exact:true});expect(getActiveDraft('reconnect-owner')).toEqual(before)
 expect(JSON.parse(localStorage.getItem(`trainlog:cancelled-draft:reconnect-owner:${before.id}`)!)).toEqual(before)
})

it('a delayed cancellation preserves the different workout opened in another tab',async()=>{
 online=true
 let release!:()=>void
 cancel.mockImplementationOnce(()=>new Promise<void>(r=>{release=r}))
 mount()
 fireEvent.click(await screen.findByRole('button',{name:'Отменить тренировку',exact:true}))
 fireEvent.click(screen.getAllByRole('button',{name:'Отменить тренировку',exact:true}).at(-1)!)
 await waitFor(()=>expect(cancel).toHaveBeenCalledOnce())
 const newer=createWorkoutDraft(programV21Templates[1],'reconnect-owner')
 saveActiveDraft(newer)
 release()
 await screen.findByText('Тренировки',{exact:true})
 expect(getActiveDraft('reconnect-owner')).toEqual(newer)
})
