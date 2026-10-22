import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSyncQueue } from '../src/hooks/useSyncQueue'
import { createWorkoutDraft } from '../src/lib/workout'
import { programV21Templates } from '../src/lib/program-v21'
import { enqueueCancelledWorkout, enqueueDraft, getCancelQueue, getSyncQueue } from '../src/lib/storage'
const {sync,cancel}=vi.hoisted(()=>({sync:vi.fn(),cancel:vi.fn()}))
vi.mock('../src/lib/trainingRepository',()=>({syncWorkoutDraft:sync,deleteWorkoutSession:cancel}))
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();vi.spyOn(navigator,'onLine','get').mockReturnValue(true);sync.mockResolvedValue(undefined);cancel.mockResolvedValue(undefined)})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
it('retries cancellation once, removes superseded queue rows, and preserves other sessions',async()=>{
 const removed=createWorkoutDraft(programV21Templates[0],'background-owner'),other=createWorkoutDraft(programV21Templates[1],'background-owner')
 enqueueDraft(removed);enqueueCancelledWorkout(removed.userId,removed.id);enqueueDraft(other)
 let release!:()=>void;cancel.mockImplementation(()=>new Promise<void>(r=>{release=r}))
 renderHook(()=>useSyncQueue('background-owner'))
 await waitFor(()=>expect(cancel).toHaveBeenCalledOnce())
 act(()=>{window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))})
 expect(cancel).toHaveBeenCalledOnce();expect(sync).not.toHaveBeenCalled()
 await act(async()=>release())
 await waitFor(()=>expect(getSyncQueue('background-owner')).toEqual([]))
 expect(getCancelQueue('background-owner')).toEqual([])
 expect(sync).toHaveBeenCalledOnce();expect(sync.mock.calls[0][0].id).toBe(other.id)
})
it('retains cancellation intent after failure and retries when foregrounded',async()=>{
 const removed=createWorkoutDraft(programV21Templates[0],'retry-owner')
 enqueueCancelledWorkout(removed.userId,removed.id);cancel.mockRejectedValueOnce(new Error('offline'))
 const view=renderHook(()=>useSyncQueue('retry-owner'))
 await waitFor(()=>expect(cancel).toHaveBeenCalledOnce());await waitFor(()=>expect(view.result.current.syncing).toBe(false))
 expect(getCancelQueue('retry-owner')).toEqual([removed.id])
 act(()=>window.dispatchEvent(new Event('focus')))
 await waitFor(()=>expect(getCancelQueue('retry-owner')).toEqual([]));expect(cancel).toHaveBeenCalledTimes(2)
})
