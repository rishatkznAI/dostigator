import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueCardio, getCachedCardio, getCardioQueue, syncCardio, validateCardio, getCardioConflicts, resolveCardioConflict, type CardioSession } from '../src/lib/cardio'
const { rpc }=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc}}))
const session:CardioSession={id:'session',user_id:'owner',activity_date:'2026-10-14',kind:'walk',duration_minutes:20,duration_seconds:1217,workout_session_id:null,distance_km:1.5,effort:5,average_pulse:120,note:'Уклон 5%',created_at:'2026-10-14T10:00:00Z',updated_at:'2026-10-14T10:00:00Z'}
const confirmed=(args:Record<string,unknown>)=>({data:{...session,...args.p_record as object,revision:Number(args.p_expected_revision)+1,updated_at:'2026-10-14T10:10:00Z'},error:null})
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();vi.spyOn(navigator,'onLine','get').mockReturnValue(true)})
describe('exact cardio queue',()=>{
 it('validates short activities and optional metrics',()=>{
  expect(validateCardio(session)).toBeNull()
  expect(validateCardio({...session,duration_minutes:0,duration_seconds:45})).toBeNull()
  expect(validateCardio({...session,duration_minutes:0,duration_seconds:0})).toContain('Время')
  expect(validateCardio({...session,effort:11})).toContain('Усилие')
  expect(validateCardio({...session,distance_km:0.001})).toContain('Дистанция')
 })
 it('keeps the complete offline result isolated by owner',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(false);enqueueCardio(session);await syncCardio('owner')
  expect(rpc).not.toHaveBeenCalled();expect(getCachedCardio('owner')[0]).toMatchObject({duration_seconds:1217,note:session.note});expect(getCachedCardio('other')).toEqual([])
 })
 it('replays the same mutation and payload after timeout, including after reload',async()=>{
  enqueueCardio(session);rpc.mockResolvedValueOnce({error:{message:'timeout'}})
  await expect(syncCardio('owner')).rejects.toThrow('timeout')
  const first=rpc.mock.calls[0][1];expect(getCardioQueue('owner')).toHaveLength(1)
  rpc.mockImplementationOnce(async(_name,args)=>confirmed(args));await syncCardio('owner')
  expect(rpc.mock.calls[1][1]).toEqual(first);expect(getCardioQueue('owner')).toEqual([])
  expect(getCachedCardio('owner')[0]).toMatchObject({duration_seconds:1217,revision:1})
 })
 it('replays an edit queued during a write using its acknowledged revision',async()=>{
  let finish!:(result:ReturnType<typeof confirmed>)=>void
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));rpc.mockImplementationOnce(async(_name,args)=>confirmed(args))
  enqueueCardio(session);const syncing=syncCardio('owner');expect(syncCardio('owner')).toBe(syncing)
  enqueueCardio({...session,note:'Новая заметка',updated_at:'2026-10-14T10:01:00Z'})
  finish(confirmed(rpc.mock.calls[0][1]));await syncing
  expect(rpc.mock.calls[1][1].p_expected_revision).toBe(1);expect(getCardioQueue('owner')).toEqual([])
  expect(getCachedCardio('owner')[0].note).toBe('Новая заметка')
 })
 it('keeps both sides of a conflict and requires an explicit resolution',async()=>{
  const remote={...session,revision:2,note:'Другое устройство'}
  enqueueCardio(session);rpc.mockResolvedValueOnce({error:{code:'40001',message:'conflict',details:JSON.stringify(remote)}})
  await expect(syncCardio('owner')).rejects.toThrow('conflict');expect(getCardioQueue('owner')).toHaveLength(1)
  expect(getCardioConflicts('owner')[0].remote?.note).toBe(remote.note)
  resolveCardioConflict('owner',session.id,'local');expect(getCardioQueue('owner')[0].revision).toBe(2)
  rpc.mockImplementationOnce(async(_name,args)=>confirmed(args));await syncCardio('owner')
  expect(getCachedCardio('owner')[0].note).toBe(session.note)
 })
 it('retains a result when the server cannot confirm seconds',async()=>{
  enqueueCardio(session);rpc.mockResolvedValueOnce({data:{...session,duration_seconds:1200,revision:1},error:null})
  await expect(syncCardio('owner')).rejects.toThrow('точное содержимое');expect(getCardioQueue('owner')).toHaveLength(1)
 })
})
