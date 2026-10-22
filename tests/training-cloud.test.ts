import { beforeEach, expect, it, vi } from 'vitest'
import { syncWorkoutDraft } from '../src/lib/trainingRepository'
import { createWorkoutDraft } from '../src/lib/workout'
import { enqueueDraft, getSyncQueue, removeQueuedDraft } from '../src/lib/storage'
import { template } from './local-browser/fixtures'
import { rebaseWorkoutConflict } from '../src/lib/workout-conflicts'
const {rpc}=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('../src/lib/supabase',()=>({supabase:{rpc}}))
beforeEach(()=>{localStorage.clear();vi.resetAllMocks()})
it('replays the exact workout graph after timeout then sends a newer queued edit',async()=>{
  const draft=createWorkoutDraft(template,'owner',new Date('2026-10-21T09:00:00Z'))
  rpc.mockResolvedValueOnce({data:null,error:{message:'timeout'}})
  await expect(syncWorkoutDraft(draft)).rejects.toThrow('timeout')
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
