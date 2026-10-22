import { describe, expect, it, vi } from 'vitest'
import { createWorkoutSyncQueue } from '../src/lib/workout-sync'
import type { WorkoutDraft } from '../src/types/training'

const draft = (id: string) => ({ id } as WorkoutDraft)
const deferred = () => {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

describe('workout sync ordering', () => {
  it('never starts a newer final snapshot before an older autosave settles', async () => {
    const first = deferred()
    const second = deferred()
    const calls: string[] = []
    const sync = vi.fn((value: WorkoutDraft) => {
      calls.push(value.id)
      return value.id === 'old' ? first.promise : second.promise
    })
    const queue = createWorkoutSyncQueue(sync)

    const oldTask = queue.enqueue(draft('old'))
    const finalTask = queue.enqueue(draft('final'))
    await Promise.resolve()
    expect(calls).toEqual(['old'])

    first.resolve()
    await oldTask
    await Promise.resolve()
    expect(calls).toEqual(['old', 'final'])

    second.resolve()
    await finalTask
    await queue.drain()
  })

  it('continues with the latest snapshot after a failed older autosave', async () => {
    const first = deferred()
    const sync = vi.fn((value: WorkoutDraft) => value.id === 'old' ? first.promise : Promise.resolve())
    const queue = createWorkoutSyncQueue(sync)

    const oldTask = queue.enqueue(draft('old'))
    const finalTask = queue.enqueue(draft('final'))
    first.reject(new Error('offline'))
    await expect(oldTask).rejects.toThrow('offline')
    await expect(finalTask).resolves.toBeUndefined()
    expect(sync.mock.calls.map(([value]) => value.id)).toEqual(['old', 'final'])
  })
})

it('serializes the same UUID across foreground and background writers, and rejects late active snapshots after completion',async()=>{
 const first=deferred();const calls:string[]=[]
 const sync=vi.fn((value:WorkoutDraft)=>{calls.push(value.finishedAt?'finished':'active');return calls.length===1?first.promise:Promise.resolve()})
 const page=createWorkoutSyncQueue(sync),background=createWorkoutSyncQueue(sync)
 const active={...draft('same-session'),userId:'same-owner',finishedAt:null}
 const a=page.enqueue(active);await Promise.resolve();expect(calls).toEqual(['active'])
 const completed=background.enqueue({...active,finishedAt:'2026-10-21T10:00:00Z'})
 const stale=page.enqueue(active)
 expect(calls).toEqual(['active']);first.resolve();await Promise.all([a,completed,stale])
 expect(calls).toEqual(['active','finished'])
})

it('a hung session does not prevent a different editor from syncing a different UUID',async()=>{
 const first=deferred();const sync=vi.fn((value:WorkoutDraft)=>value.id==='hung'?first.promise:Promise.resolve())
 const one=createWorkoutSyncQueue(sync),two=createWorkoutSyncQueue(sync)
 const pending=one.enqueue({...draft('hung'),userId:'owner'});await Promise.resolve()
 await expect(two.enqueue({...draft('other'),userId:'owner'})).resolves.toBeUndefined()
 first.resolve();await pending
})
it('serializes cancellation and blocks late writes in other editors',async()=>{
 const first=deferred();const sync=vi.fn(()=>first.promise);const cancel=vi.fn(async()=>undefined)
 const page=createWorkoutSyncQueue(sync),background=createWorkoutSyncQueue(sync)
 const value={...draft('cancel-me'),userId:'owner'}
 const saving=page.enqueue(value);await Promise.resolve()
 const cancelling=background.cancel('owner',value.id,cancel)
 const stale=page.enqueue(value);void stale.catch(()=>undefined)
 expect(cancel).not.toHaveBeenCalled();first.resolve();await saving;await cancelling
 await expect(stale).rejects.toThrow('отмены');expect(cancel).toHaveBeenCalledOnce();expect(sync).toHaveBeenCalledOnce()
})
it('allows the retained draft to retry when cancellation fails',async()=>{
 const sync=vi.fn(async()=>undefined),queue=createWorkoutSyncQueue(sync)
 await expect(queue.cancel('owner','session',async()=>{throw new Error('server unavailable')})).rejects.toThrow()
 await queue.enqueue({...draft('session'),userId:'owner'});expect(sync).toHaveBeenCalledOnce()
})
