import { beforeEach, expect, it, vi } from 'vitest'
import { loadCardio, getCardioQueue, cardioDuration, type CardioSession } from '../src/lib/cardio'
import { loadCardioReceipt, saveCardioReceipt } from '../src/lib/cardio-receipts'
import { parseCardioBackup } from '../src/lib/cardio-backup'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc}}))
const legacy:CardioSession={id:'legacy',user_id:'owner',activity_date:'2026-10-21',kind:'walk',duration_minutes:20,duration_seconds:null,revision:0,distance_km:null,average_pulse:null,effort:null,note:'',created_at:'2026-10-21T10:00:00Z',updated_at:'2026-10-21T10:00:00Z'}
beforeEach(()=>{localStorage.clear();vi.resetAllMocks()})
it('restores exact time and association without any device receipt',async()=>{
  const record={...legacy,duration_seconds:1217,workout_session_id:'strength',revision:1}
  rpc.mockResolvedValue({data:[record],error:null})
  expect((await loadCardio('owner'))[0]).toMatchObject({duration_seconds:1217,workout_session_id:'strength'})
  expect(loadCardioReceipt('owner',record)?.durationSeconds).toBe(1217)
  expect(getCardioQueue('owner')).toEqual([])
})
it('keeps unknown legacy precision and only migrates a matching receipt',async()=>{
  rpc.mockResolvedValue({data:[legacy],error:null});await loadCardio('owner')
  expect(cardioDuration(legacy)).toBe('20 мин');expect(getCardioQueue('owner')).toEqual([])
  saveCardioReceipt('owner',legacy,{durationSeconds:1217,workoutId:null,updatedAt:legacy.updated_at})
  await loadCardio('owner');expect(getCardioQueue('owner')[0]).toMatchObject({duration_seconds:1217,legacy_updated_at:legacy.updated_at})
})
it('rejects cross-owner backup and retains exact seconds in a valid backup',()=>{
  const backup={format:'dostigator-cardio',version:1,ownerId:'owner',exportedAt:'',records:[{...legacy,duration_seconds:1217,revision:1}]}
  expect(parseCardioBackup(backup,'owner').records[0].duration_seconds).toBe(1217)
  expect(()=>parseCardioBackup(backup,'other')).toThrow('этого аккаунта')
})
it('does not let a read started before an acknowledged write roll the cache back',async()=>{
  let finish!:(value:{data:CardioSession[];error:null})=>void
  localStorage.setItem('trainlog:cardio:owner',JSON.stringify([legacy]))
  rpc.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve}))
  const loading=loadCardio('owner')
  localStorage.setItem('trainlog:cardio:owner',JSON.stringify([{...legacy,duration_seconds:1217,revision:2}]))
  finish({data:[{...legacy,duration_seconds:1216,revision:1}],error:null})
  expect((await loading)[0]).toMatchObject({duration_seconds:1217,revision:2})
})
