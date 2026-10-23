import { beforeEach, expect, it, vi } from 'vitest'
import { correctWorkoutSet, correctionKey } from '../src/lib/workout-corrections'
import type { HistoryWorkout } from '../src/types/training'
const mock=vi.hoisted(()=>({rpc:vi.fn(),getUser:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc:mock.rpc,auth:{getUser:mock.getUser}}}))
const set={id:'set',setNumber:1,weightKg:40,reps:10,rir:null,done:true,isWarmup:false,completedAt:'2026-10-01T10:01:00Z'}
const workout:HistoryWorkout={id:'session',revision:2,updatedAt:'2026-10-01T11:00:00Z',templateCode:'A',title:'A',startedAt:'2026-10-01T10:00:00Z',finishedAt:'2026-10-01T11:00:00Z',timerPausedDurationMs:0,readinessMode:null,exercises:[{id:'exercise',exerciseKey:'press',exerciseName:'Press',target:'8–12',sortOrder:1,skipped:false,skipReason:'',sets:[set]}]}
const values={weightKg:42.5,reps:12,rir:null}
const ack=(revision=3,reps=12)=>({data:{id:'session',revision,updated_at:'2026-10-01T12:00:00Z',set:{id:'set',weight_kg:42.5,reps,rir:null}},error:null})
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();mock.getUser.mockResolvedValue({data:{user:{id:'owner'}},error:null});Object.defineProperty(navigator,'onLine',{configurable:true,value:true})})
it('corrects one fact with optional RIR without reopening or changing workout identity',async()=>{
 mock.rpc.mockResolvedValue(ack());const result=await correctWorkoutSet('owner',workout,set,values)
 expect(result.finishedAt).toBe(workout.finishedAt);expect(result.exercises[0].sets[0]).toMatchObject({...set,...values});expect(workout.exercises[0].sets[0].weightKg).toBe(40)
 expect(mock.rpc.mock.calls[0][1]).toMatchObject({p_expected_owner:'owner',p_expected_revision:2,p_values:{weight_kg:42.5,reps:12,rir:null}})
 expect(localStorage.getItem(correctionKey('owner','set'))).toBeNull()
})
it('replays the exact mutation after a dropped response',async()=>{
 mock.rpc.mockRejectedValueOnce(new Error('Network')).mockResolvedValueOnce(ack())
 await expect(correctWorkoutSet('owner',workout,set,values)).rejects.toThrow('Network')
 const pending=JSON.parse(localStorage.getItem(correctionKey('owner','set'))!)
 await correctWorkoutSet('owner',workout,set,values)
 expect(mock.rpc.mock.calls[1][1]).toEqual(pending)
})
it('resolves an uncertain earlier save before applying newer typed values',async()=>{
 mock.rpc.mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(ack()).mockResolvedValueOnce(ack(4,11))
 await expect(correctWorkoutSet('owner',workout,set,values)).rejects.toThrow()
 const result=await correctWorkoutSet('owner',workout,set,{...values,reps:11})
 expect(mock.rpc.mock.calls[1][1].p_values.reps).toBe(12);expect(mock.rpc.mock.calls[2][1].p_expected_revision).toBe(3)
 expect(result.exercises[0].sets[0].reps).toBe(11)
})
it('keeps an uncertain request until a valid acknowledgement arrives',async()=>{
 mock.rpc.mockResolvedValue(ack(99));await expect(correctWorkoutSet('owner',workout,set,values)).rejects.toThrow('не подтвердил')
 expect(localStorage.getItem(correctionKey('owner','set'))).not.toBeNull()
})
it('does not overwrite a concurrent edit and permits a fresh request only after reload',async()=>{
 mock.rpc.mockResolvedValue({data:null,error:{code:'PT409'}})
 await expect(correctWorkoutSet('owner',workout,set,values)).rejects.toThrow('другом устройстве')
 expect(localStorage.getItem(correctionKey('owner','set'))).toBeNull()
})
it('rejects writes with another identity and offline writes before RPC',async()=>{
 mock.getUser.mockResolvedValue({data:{user:{id:'another'}},error:null})
 await expect(correctWorkoutSet('owner',workout,set,values)).rejects.toThrow('Аккаунт изменился')
 Object.defineProperty(navigator,'onLine',{configurable:true,value:false})
 await expect(correctWorkoutSet('owner',workout,set,values)).rejects.toThrow('Подключись к сети');expect(mock.rpc).not.toHaveBeenCalled()
})
