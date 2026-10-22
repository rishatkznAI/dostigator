import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {MemoryRouter,Route,Routes} from 'react-router-dom'
import {WorkoutPage} from '../src/pages/WorkoutPage'
import {getActiveDraft} from '../src/lib/storage'

// Keep the actual product hook, repository and program loader. Only external
// identity/network boundaries are replaced; this suite never calls Supabase.
vi.mock('../src/context/AuthContext',()=>({useAuth:()=>({user:{id:'product-owner'}})}))
vi.mock('../src/lib/supabase',()=>({supabase:{from:()=>{throw new Error('No backend in product program acceptance')}}}))
vi.mock('../src/lib/rest-alert',()=>({primeRestAlert:vi.fn(),notifyRestComplete:vi.fn()}))
beforeEach(()=>{localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false);localStorage.setItem('trainlog:auto-rest:product-owner','true')})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const open=(code:string)=>render(<MemoryRouter initialEntries={['/training/workout/'+code]}><Routes><Route path="/training/workout/:code" element={<WorkoutPage/>}/></Routes></MemoryRouter>)
it.each([['A','Жим ногами'],['B','Наклонный жим гантелей']])('runs %s through the unmocked product program path and restores the recorded set',async(code,first)=>{
 const view=open(code)
 await screen.findByText('Программа V2.1 активна')
 fireEvent.click(screen.getByRole('button',{name:'Начать тренировку',exact:true}))
 const weight=await screen.findByRole('spinbutton',{name:`${first}, подход 1, вес кг`})
 fireEvent.change(weight,{target:{value:'10'}})
 fireEvent.click(screen.getByRole('button',{name:`Записать подход 1 · ${first}`}))
 await waitFor(()=>expect(getActiveDraft('product-owner')?.exercises[0].sets[0].done).toBe(true))
 const draft=getActiveDraft('product-owner')!
 expect(draft.programRevision).toBe('v2.1-2026-10-22')
 expect(draft.exercises.map(e=>e.sets.length)).toEqual([3,3,3,2,2,2])
 expect(draft.exercises[0].sets[0].rir).toBeNull()
 expect(draft.activeRest?.plannedSeconds).toBe(120)
 view.unmount();open(code)
 await screen.findByRole('button',{name:`Записать подход 2 · ${first}`})
 expect(getActiveDraft('product-owner')?.id).toBe(draft.id)
 expect(getActiveDraft('product-owner')?.exercises[0].sets.filter(s=>s.done)).toHaveLength(1)
})
