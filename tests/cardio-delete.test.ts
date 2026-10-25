import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteCardio, enqueueCardio, getCachedCardio, getCardioDeletes, getCardioQueue, syncCardio } from '../src/lib/cardio'
const {rpc,removePhotos}=vi.hoisted(()=>({rpc:vi.fn(),removePhotos:vi.fn()}))
vi.mock('../src/lib/cardio-photos',()=>({deleteCardioResultPhotos:removePhotos}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc}}))
const session={id:'test',user_id:'owner',activity_date:'2026-10-14',kind:'elliptical' as const,duration_minutes:25,duration_seconds:1517,workout_session_id:null,distance_km:null,effort:null,average_pulse:null,note:'',created_at:'2026-10-14T10:00:00Z',updated_at:'2026-10-14T10:00:00Z'}
const ack=(args:Record<string,unknown>)=>({data:{...session,...args.p_record as object,revision:Number(args.p_expected_revision)+1,deleted_at:args.p_delete?'2026-10-14T11:00:00Z':null},error:null})
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();removePhotos.mockResolvedValue(undefined);vi.spyOn(navigator,'onLine','get').mockReturnValue(false)})
describe('versioned deletion queue',()=>{
 it('keeps an offline tombstone and prevents stale edits from resurrecting it',()=>{
  enqueueCardio(session);deleteCardio('owner','test');expect(getCachedCardio('owner')).toEqual([]);expect(getCardioQueue('owner')).toEqual([])
  expect(getCardioDeletes('owner')).toEqual(['test']);expect(getCardioDeletes('other')).toEqual([]);expect(()=>enqueueCardio(session)).toThrow('удаления')
 })
 it('retries a delete with the same mutation and waits for a tombstone acknowledgement',async()=>{
  enqueueCardio(session);deleteCardio('owner','test');vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
  rpc.mockResolvedValueOnce({error:{message:'failed'}});await expect(syncCardio('owner')).rejects.toThrow('failed')
  const args=rpc.mock.calls[0][1];expect(args.p_delete).toBe(true);expect(getCardioDeletes('owner')).toEqual(['test'])
  rpc.mockImplementationOnce(async(_name,input)=>ack(input));await syncCardio('owner')
  expect(rpc.mock.calls[1][1]).toEqual(args);expect(getCardioDeletes('owner')).toEqual([])
 })
 it('deletes with the revision acknowledged by a write already in flight',async()=>{
  vi.spyOn(navigator,'onLine','get').mockReturnValue(true);let finish!:(value:ReturnType<typeof ack>)=>void
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}));rpc.mockImplementationOnce(async(_name,input)=>ack(input))
  enqueueCardio(session);const syncing=syncCardio('owner');deleteCardio('owner',session.id);finish(ack(rpc.mock.calls[0][1]));await syncing
  expect(rpc.mock.calls[1][1]).toMatchObject({p_delete:true,p_expected_revision:1});expect(getCachedCardio('owner')).toEqual([]);expect(getCardioDeletes('owner')).toEqual([])
 })
})

it('retains the exact cardio deletion until private photo cleanup is acknowledged',async()=>{
 enqueueCardio(session);deleteCardio('owner','test');vi.spyOn(navigator,'onLine','get').mockReturnValue(true)
 rpc.mockImplementation(async(_name,input)=>ack(input));removePhotos.mockRejectedValueOnce(new Error('photo offline')).mockResolvedValue(undefined)
 await expect(syncCardio('owner')).rejects.toThrow('photo offline')
 expect(getCardioDeletes('owner')).toEqual(['test']);const payload=rpc.mock.calls[0][1]
 await syncCardio('owner');expect(rpc.mock.calls[1][1]).toEqual(payload);expect(getCardioDeletes('owner')).toEqual([])
})
