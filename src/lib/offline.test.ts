import { afterEach, describe, expect, it } from 'vitest'
import { persistOrQueue, readQueue } from './offline'

afterEach(() => {
  localStorage.clear()
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
})

describe('offline queue', () => {
  it('stores an idempotent upsert while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    await persistOrQueue('dostigator_goals', { id: 'goal-1', title: 'Прочитать книгу' })
    await persistOrQueue('dostigator_goals', { id: 'goal-1', title: 'Прочитать книгу полностью' })
    expect(readQueue()).toHaveLength(1)
    expect(readQueue()[0].payload).toMatchObject({ id: 'goal-1', title: 'Прочитать книгу полностью' })
  })
})
