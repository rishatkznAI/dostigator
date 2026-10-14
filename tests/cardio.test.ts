import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enqueueCardio, getCachedCardio, getCardioQueue, syncCardio, validateCardio, type CardioSession } from '../src/lib/cardio'

const { upsert } = vi.hoisted(() => ({ upsert: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from: () => ({ upsert }) } }))
const session: CardioSession = { id: 'session', user_id: 'owner', activity_date: '2026-10-14', kind: 'walk', duration_minutes: 20, distance_km: 1.5, effort: 5, average_pulse: 120, note: 'Уклон 5%, дыхание ровное', created_at: '2026-10-14T10:00:00Z', updated_at: '2026-10-14T10:00:00Z' }

describe('cardio persistence', () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true) })
  it('validates optional metrics and rejects invalid values', () => {
    expect(validateCardio(session)).toBeNull()
    expect(validateCardio({ ...session, duration_minutes: 0 })).toContain('Время')
    expect(validateCardio({ ...session, effort: 11 })).toContain('Усилие')
    expect(validateCardio({ ...session, distance_km: 0.001 })).toContain('Дистанция')
    expect(validateCardio({ ...session, distance_km: null, effort: null, average_pulse: null })).toBeNull()
  })
  it('keeps offline notes and isolates queues by owner', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    enqueueCardio(session)
    await syncCardio('owner')
    expect(upsert).not.toHaveBeenCalled()
    expect(getCachedCardio('owner')[0]?.note).toBe(session.note)
    expect(getCachedCardio('other-owner')).toEqual([])
  })
  it('retains a failed write for retry without duplicating its id', async () => {
    enqueueCardio(session)
    upsert.mockResolvedValueOnce({ error: { message: 'network' } })
    await expect(syncCardio('owner')).rejects.toThrow('network')
    expect(getCardioQueue('owner')).toHaveLength(1)
    upsert.mockResolvedValueOnce({ error: null })
    await syncCardio('owner')
    expect(getCardioQueue('owner')).toEqual([])
    expect(getCachedCardio('owner')).toHaveLength(1)
    expect(upsert).toHaveBeenLastCalledWith(session, { onConflict: 'id' })
  })
  it('replays a newer edit made during an in-flight sync', async () => {
    let resolveFirst!: (result: { error: null }) => void
    upsert.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
    upsert.mockResolvedValueOnce({ error: null })
    enqueueCardio(session)
    const first = syncCardio('owner')
    expect(syncCardio('owner')).toBe(first)
    enqueueCardio({ ...session, note: 'Новая заметка', updated_at: '2026-10-14T10:01:00Z' })
    resolveFirst({ error: null })
    await first
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(getCachedCardio('owner')[0]?.note).toBe('Новая заметка')
    expect(getCardioQueue('owner')).toEqual([])
  })
})
