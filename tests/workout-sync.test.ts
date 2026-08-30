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
