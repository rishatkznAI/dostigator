import { afterEach, describe, expect, it } from 'vitest'
import { localDateFromTimestamp, startOfWeek, weekAsOf, weekDates } from './date'

const initialTimezone = process.env.TZ
afterEach(() => { process.env.TZ = initialTimezone })

describe('local calendar boundaries', () => {
  it('keeps Monday and Sunday in the same Moscow week', () => {
    process.env.TZ = 'Europe/Moscow'
    expect(startOfWeek(new Date('2026-08-24T00:15:00+03:00'))).toBe('2026-08-24')
    expect(startOfWeek(new Date('2026-08-30T23:45:00+03:00'))).toBe('2026-08-24')
  })

  it('moves a late UTC completion into the next Moscow local day and week', () => {
    process.env.TZ = 'Europe/Moscow'
    const timestamp = '2026-08-30T23:30:00Z'
    expect(localDateFromTimestamp(timestamp)).toBe('2026-08-31')
    expect(startOfWeek(new Date(timestamp))).toBe('2026-08-31')
  })

  it('enumerates dates safely across a New York DST boundary', () => {
    process.env.TZ = 'America/New_York'
    expect(weekDates('2026-03-02')).toEqual(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08'])
    expect(weekDates('2026-03-09')).toEqual(['2026-03-09', '2026-03-10', '2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14', '2026-03-15'])
  })

  it('uses today for an incomplete week and Sunday for a completed week', () => {
    expect(weekAsOf('2026-08-24', '2026-08-27')).toBe('2026-08-27')
    expect(weekAsOf('2026-08-17', '2026-08-27')).toBe('2026-08-23')
  })
})
