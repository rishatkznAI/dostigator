import { beforeEach, expect, it, vi } from 'vitest'
import { deleteWorkoutSession, loadHistory, syncWorkoutDraft } from '../src/lib/trainingRepository'
import { createWorkoutDraft } from '../src/lib/workout'
import { enqueueDraft, getSyncQueue, removeQueuedDraft } from '../src/lib/storage'
import { template } from './local-browser/fixtures'
import { rebaseWorkoutConflict } from '../src/lib/workout-conflicts'
import { createPersonalExercise, decodePersonalExercise, encodePersonalExercise, FREE_WORKOUT_NOTE, personalExercisesFromHistory, startFreeWorkout } from '../src/lib/free-workout'
const {rpc,getUser,from}=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn(),from:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc,from,auth:{getUser}}}))
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();getUser.mockResolvedValue({data:{user:{id:'owner'}},error:null})})
it('persists free sessions and custom exercise snapshots through the existing atomic API', async () => {
 const exercise=createPersonalExercise('Мой жим','Плечи','Моя заметка')
 const draft=startFreeWorkout('owner','Вне расписания',[{exercise,sortOrder:1,setCount:1,repTarget:'8–12'}])
 rpc.mockResolvedValue({data:{id:draft.id,revision:1,finished_at:null},error:null})
 await syncWorkoutDraft(draft)
 const payload=rpc.mock.calls[0][1]
 expect(payload.p_session).toMatchObject({template_code:null,note:FREE_WORKOUT_NOTE,title:'Вне расписания'})
 expect(payload.p_exercises[0].exercise_key).toBeNull()
 expect(decodePersonalExercise(payload.p_exercises[0].note,exercise.name)).toEqual(exercise)
})
it('restores custom exercise identity from cloud history without reclassifying legacy null templates', async () => {
 const exercise=createPersonalExercise('Мой жим','Плечи','Моя заметка')
 const sessions=[{id:'free-session',template_code:null,note:FREE_WORKOUT_NOTE,title:'Свободная',finished_at:'2026-10-25T10:00:00Z'}, {id:'legacy-session',template_code:null,note:'',title:'Старая',finished_at:'2026-10-24T10:00:00Z'}]
 const exercises=[{id:'custom-exercise',session_id:'free-session',exercise_key:null,note:encodePersonalExercise(exercise),exercise_name:exercise.name,target:'8–12',sort_order:1}, {id:'legacy-exercise',session_id:'legacy-session',exercise_key:null,note:'',exercise_name:'Удалённое из старой программы',target:'10',sort_order:1}]
 from.mockImplementation(table=>{
  const reply=Promise.resolve({data:table==='workout_sessions'?sessions:table==='workout_session_exercises'?exercises:[],error:null})
  return {select(){return this},not(){return this},in(){return this},order(){return this},limit(){return this},then:reply.then.bind(reply)}
 })
 const history=await loadHistory()
 expect(history[0].templateCode).toBe('free')
 expect(history[0].exercises[0]).toMatchObject({exerciseKey:exercise.key,customExercise:exercise})
 expect(personalExercisesFromHistory(history)).toEqual([{exercise,target:'8–12'}])
 expect(history[1].templateCode).toBeNull()
 expect(history[1].exercises[0].customExercise).toBeUndefined()
})
it('replays the exact workout graph after timeout then sends a newer queued edit',async()=>{
  const draft=createWorkoutDraft(template,'owner',new Date('2026-10-21T09:00:00Z'))
  rpc.mockResolvedValueOnce({data:null,error:{message:'timeout'}})
  await expect(syncWorkoutDraft(draft)).rejects.toThrow('Данные на устройстве сохранены')
  const original=rpc.mock.calls[0][1]
  const newer={...draft,title:'Newer local input',updatedAt:'2026-10-21T09:01:00Z'}
  rpc.mockImplementation(async(_name,args)=>({data:{id:draft.id,revision:Number(args.p_expected_revision)+1,finished_at:null},error:null}))
  await syncWorkoutDraft(newer)
  expect(rpc.mock.calls[1][1]).toEqual(original)
  expect(rpc.mock.calls[2][1]).toMatchObject({p_expected_revision:1,p_session:{title:newer.title}})
})
it('does not remove a newer local snapshot when an older one is acknowledged',()=>{
  const draft=createWorkoutDraft(template,'owner',new Date('2026-10-21T09:00:00Z'))
  enqueueDraft(draft);enqueueDraft({...draft,updatedAt:'2026-10-21T09:02:00Z'})
  removeQueuedDraft('owner',draft.id,draft.updatedAt)
  expect(getSyncQueue('owner')).toHaveLength(1)
})
it('retains an exact conflicting request without rebasing it silently',async()=>{
  const draft=createWorkoutDraft(template,'owner')
  rpc.mockResolvedValue({data:null,error:{code:'40001',message:'conflict'}})
  await expect(syncWorkoutDraft(draft)).rejects.toThrow('Локальный ввод сохранён')
  const first=rpc.mock.calls[0][1]
  await expect(syncWorkoutDraft(draft)).rejects.toThrow()
  expect(rpc.mock.calls[1][1]).toEqual(first)
})
it('explicit conflict resolution sends the compared new input rather than an older failed request',async()=>{
  const draft=createWorkoutDraft(template,'owner',new Date('2026-10-21T09:00:00Z'))
  rpc.mockResolvedValueOnce({error:{message:'timeout'}})
  await expect(syncWorkoutDraft(draft)).rejects.toThrow()
  const newer={...draft,title:'Latest compared input',updatedAt:'2026-10-21T09:01:00Z'}
  enqueueDraft(newer)
  rpc.mockResolvedValueOnce({error:{code:'40001',details:JSON.stringify({session:{id:draft.id,revision:2,updated_at:'2026-10-21T09:00:30Z',finished_at:null},exercises:[],sets:[]})}})
  await expect(syncWorkoutDraft(newer)).rejects.toThrow()
  const compared=rebaseWorkoutConflict('owner',draft.id)
  rpc.mockResolvedValueOnce({data:{id:draft.id,revision:3,finished_at:null},error:null})
  await syncWorkoutDraft(compared)
  expect(rpc.mock.calls[2][1]).toMatchObject({p_expected_revision:2,p_session:{title:newer.title}})
})
it('explains missing server migration without writing an acknowledgement',async()=>{
 const draft=createWorkoutDraft(template,'owner');rpc.mockResolvedValue({error:{code:'PGRST202',message:'missing'}})
 await expect(syncWorkoutDraft(draft)).rejects.toThrow('Сервер ещё не обновлён')
 const meta=JSON.parse(localStorage.getItem(`trainlog:workout-cloud:owner:${draft.id}`)!)
 expect(meta.updatedAt).toBeUndefined();expect(meta.request).toBeTruthy()
})
it('rejects an acknowledgement for the wrong revision or terminal state',async()=>{
 const draft=createWorkoutDraft(template,'owner');rpc.mockResolvedValue({data:{id:draft.id,revision:8,finished_at:null}})
 await expect(syncWorkoutDraft(draft)).rejects.toThrow('Сервер не подтвердил')
 rpc.mockResolvedValue({data:{id:draft.id,revision:1,finished_at:'2026-10-22'}})
 await expect(syncWorkoutDraft(draft)).rejects.toThrow('Сервер не подтвердил')
})
it('reconciles a lost save response before cancellation and retains a tombstone',async()=>{
 const draft=createWorkoutDraft(template,'owner');getUser.mockResolvedValue({data:{user:{id:'owner'}}})
 rpc.mockResolvedValueOnce({error:{message:'timeout'}});await expect(syncWorkoutDraft(draft)).rejects.toThrow()
 const request=rpc.mock.calls[0][1]
 rpc.mockResolvedValueOnce({data:{id:draft.id,revision:1,finished_at:null}}).mockResolvedValueOnce({data:{id:draft.id,cancelled:true}})
 await deleteWorkoutSession(draft.id)
 expect(rpc.mock.calls[1]).toEqual(['training_save_workout',request]);expect(rpc.mock.calls[2][1]).toMatchObject({p_expected_revision:1})
 await expect(syncWorkoutDraft({...draft,updatedAt:new Date(Date.now()+1000).toISOString()})).rejects.toThrow('отменена')
 expect(rpc).toHaveBeenCalledTimes(3)
})
it('does not confirm cancellation from an empty server response',async()=>{
 getUser.mockResolvedValue({data:{user:{id:'owner'}}});rpc.mockResolvedValue({data:{},error:null})
 await expect(deleteWorkoutSession('session')).rejects.toThrow('Сервер не подтвердил отмену')
 expect(localStorage.getItem('trainlog:workout-cloud:owner:session')).toBeNull()
})

it('does not submit an old profile draft after account change',async()=>{
 getUser.mockResolvedValue({data:{user:{id:'other'}},error:null})
 await expect(syncWorkoutDraft(createWorkoutDraft(template,'owner'))).rejects.toThrow('Аккаунт изменился')
 expect(rpc).not.toHaveBeenCalled()
})

it('does not cancel an old profile workout under the newly signed-in account',async()=>{
 getUser.mockResolvedValue({data:{user:{id:'other'}},error:null})
 await expect(deleteWorkoutSession('old-session','owner')).rejects.toThrow('Аккаунт изменился')
 expect(rpc).not.toHaveBeenCalled()
})

it('stores HTTP 409 conflicts without treating them as network failures',async()=>{
 const draft=createWorkoutDraft(template,'owner')
 rpc.mockResolvedValue({error:{code:'PT409',message:'conflict',details:JSON.stringify({session:{id:draft.id,revision:2},exercises:[],sets:[]})}})
 await expect(syncWorkoutDraft(draft)).rejects.toThrow('сравни версии')
 expect(JSON.parse(localStorage.getItem('trainlog:workout-conflicts:owner')!)[0].id).toBe(draft.id)
})

it('replays an envelope from the published client without changing its mutation payload',async()=>{
 const draft=createWorkoutDraft(template,'owner')
 const oldPayload={p_session:{id:draft.id,finished_at:null},p_exercises:[],p_sets:[],p_deleted_set_ids:[]}
 const mutation=crypto.randomUUID()
 localStorage.setItem(`trainlog:workout-cloud:owner:${draft.id}`,JSON.stringify({request:{stamp:draft.updatedAt,mutation,revision:0,payload:oldPayload}}))
 rpc.mockResolvedValue({data:{id:draft.id,revision:1,finished_at:null},error:null})
 await syncWorkoutDraft(draft)
 expect(rpc.mock.calls[0][1]).toEqual({...oldPayload,p_mutation_id:mutation,p_expected_revision:0,p_expected_owner:'owner'})
})
