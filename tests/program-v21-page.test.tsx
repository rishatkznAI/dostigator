import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {MemoryRouter,Route,Routes} from 'react-router-dom'
import {WorkoutPage} from '../src/pages/WorkoutPage'
import {programV21Templates} from '../src/lib/program-v21'
import {getActiveDraft,saveActiveDraft} from '../src/lib/storage'
import {createWorkoutDraft} from '../src/lib/workout'
import {template as legacy} from './local-browser/fixtures'
vi.mock('../src/context/AuthContext',()=>({useAuth:()=>({user:{id:'v21-owner'}})}))
vi.mock('../src/hooks/useTemplates',()=>({useTemplates:()=>({templates:programV21Templates,loading:false,error:null})}))
vi.mock('../src/lib/trainingRepository',()=>({loadExerciseLibrary:vi.fn().mockResolvedValue([]),loadHistory:vi.fn().mockResolvedValue([]),loadPreviousResults:vi.fn().mockResolvedValue(new Map()),syncWorkoutDraft:vi.fn().mockResolvedValue(undefined),deleteWorkoutSession:vi.fn()}))
beforeEach(()=>{localStorage.clear();vi.spyOn(navigator,'onLine','get').mockReturnValue(false)})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
const open=(code:string)=>render(<MemoryRouter initialEntries={['/training/workout/'+code]}><Routes><Route path="/training/workout/:code" element={<WorkoutPage/>}/></Routes></MemoryRouter>)
it('starts C with no optional lifts selected; choosing only triceps creates exactly two sets',async()=>{
 open('C')
 const start=await screen.findByRole('button',{name:'Начать выбранные упражнения'})
 expect(start).toBeDisabled();expect(getActiveDraft('v21-owner')).toBeNull()
 expect(screen.getByRole('link',{name:'Перейти к кардио · 30–45 минут'})).toHaveAttribute('href','/training/cardio?program=C')
 fireEvent.click(screen.getByRole('checkbox',{name:/Разгибание рук/}))
 fireEvent.click(start)
 await waitFor(()=>expect(getActiveDraft('v21-owner')?.exercises).toHaveLength(1))
 expect(getActiveDraft('v21-owner')?.exercises[0].exercise.key).toBe('triceps_pushdown')
 expect(getActiveDraft('v21-owner')?.exercises[0].sets).toHaveLength(2)
})
it('resumes the actual legacy exercise and set counts rather than rebuilding from the new A template',async()=>{
 const old=createWorkoutDraft(legacy,'v21-owner');saveActiveDraft(old)
 open('A')
 await screen.findByText(/Продолжается прежний черновик/)
 expect(getActiveDraft('v21-owner')).toEqual(old)
 expect(screen.getByRole('progressbar',{name:'Выполненные рабочие подходы'})).toHaveAttribute('max','6')
 expect(screen.queryByRole('heading',{name:'Жим ногами'})).not.toBeInTheDocument()
})
