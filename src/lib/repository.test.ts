import { describe, expect, it } from 'vitest'
import { isBackup, makeBackup, stripOwnership } from './repository'
import type { AppData, Goal } from '../types'

const data: AppData = { areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] }

describe('personal backup', () => {
  it('creates and validates a Dostigator backup', () => {
    const backup = makeBackup(data)
    expect(isBackup(backup)).toBe(true)
    expect(isBackup({ product: 'trainlog', version: 1, data })).toBe(false)
  })

  it('removes user ownership before import', () => {
    const row = { id: 'goal', user_id: 'private-user', title: 'Книга' } as Goal
    expect(stripOwnership(row)).not.toHaveProperty('user_id')
    expect(stripOwnership(row)).toHaveProperty('title', 'Книга')
  })
})
