import { beforeEach, describe, expect, it } from 'vitest'
import { cardioElapsedMs, cardioDraftKey, changeCardioTimer, getCardioGoal, loadCardioDraft, newCardioDraft, saveCardioDraft } from '../src/lib/cardio-workout'
import type { CardioSession } from '../src/lib/cardio'

const previous: CardioSession = { id: 'old', user_id: 'owner', activity_date: '2026-10-12', kind: 'walk', duration_minutes: 30, distance_km: null, effort: 1, average_pulse: 90, note: '', created_at: '2026-10-12T10:00:00Z', updated_at: '2026-10-12T10:00:00Z' }

describe('cardio workout state', () => {
  beforeEach(() => localStorage.clear())
  it('uses only actual compatible history and never increases based on effort or pulse', () => {
    expect(getCardioGoal([previous], 'walk', '2026-10-14').minutes).toBe(30)
    expect(getCardioGoal([{ ...previous, effort: 10, average_pulse: 200 }], 'walk', '2026-10-14').minutes).toBe(30)
    expect(getCardioGoal([previous], 'bike', '2026-10-14').previous).toBeUndefined()
    expect(getCardioGoal([previous], 'walk', '2026-10-28').minutes).toBe(30)
    expect(getCardioGoal([{ ...previous, duration_minutes: 5 }], 'walk', '2026-10-28').minutes).toBe(5)
    expect(getCardioGoal([previous], 'walk', '2026-10-14', 'old').previous).toBeUndefined()
  })
  it('pauses, restores and resumes without counting paused time', () => {
    const running = changeCardioTimer(newCardioDraft('owner'), 'start', 1000)
    expect(cardioElapsedMs(running, 31_000)).toBe(30_000)
    const paused = changeCardioTimer(running, 'pause', 61_000)
    expect(cardioElapsedMs(paused, 500_000)).toBe(60_000)
    localStorage.setItem(cardioDraftKey('owner'), JSON.stringify(paused))
    const restored = loadCardioDraft('owner')
    const resumed = changeCardioTimer(restored, 'resume', 700_000)
    const finished = changeCardioTimer(resumed, 'finish', 730_000)
    expect(finished).toMatchObject({ phase: 'review', elapsedMs: 90_000, minutes: '1', startedAt: null })
    expect(changeCardioTimer(finished, 'finish', 900_000)).toBe(finished)
  })
  it('restores a running timer and does not invent a minute for a short activity', () => {
    const running = changeCardioTimer(newCardioDraft('owner'), 'start', 1000)
    localStorage.setItem(cardioDraftKey('owner'), JSON.stringify(running))
    expect(cardioElapsedMs(loadCardioDraft('owner'), 31_000)).toBe(30_000)
    expect(changeCardioTimer(running, 'finish', 31_000)).toMatchObject({ minutes: '0', seconds:'30', phase: 'review' })
    expect(loadCardioDraft('other').userId).toBe('other')
  })
  it('does not let a stale tab replace a newer timer draft', () => {
    const stale = newCardioDraft('owner')
    const running = { ...changeCardioTimer(stale, 'start'), updatedAt: stale.updatedAt + 1 }
    expect(saveCardioDraft(running)).toBe(true)
    expect(saveCardioDraft(stale)).toBe(false)
    expect(loadCardioDraft('owner')).toMatchObject({ id: running.id, phase: 'running' })
  })
})

 it('restores seconds from an older unfinished timer review without changing a saved legacy fact',async()=>{
  const {newCardioDraft,loadCardioDraft,cardioDraftKey}=await import('../src/lib/cardio-workout')
  const draft={...newCardioDraft('legacy-owner'),phase:'review',minutes:'2',elapsedMs:152000,seconds:undefined}
  localStorage.setItem(cardioDraftKey('legacy-owner'),JSON.stringify(draft))
  expect(loadCardioDraft('legacy-owner')).toMatchObject({id:draft.id,phase:'review',minutes:'2',seconds:'32',elapsedMs:152000})
  localStorage.setItem(cardioDraftKey('legacy-owner'),JSON.stringify({...draft,phase:'saved'}))
  expect(loadCardioDraft('legacy-owner')).toMatchObject({id:draft.id,phase:'saved',minutes:'2',seconds:'0'})
  localStorage.removeItem(cardioDraftKey('legacy-owner'))
 })
