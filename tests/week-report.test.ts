import { describe, expect, it } from 'vitest'
import { buildWeeklyReportDocument, weeklyReportFilename } from '../src/lib/weekly-report-pdf'
import { getWeekRange, localDateKey, summarizeWeek } from '../src/lib/week'
import type { WeeklyReportData } from '../src/types/training'

const { weekStart, weekEndExclusive } = getWeekRange(new Date('2026-08-27T12:00:00+03:00'))

const report: WeeklyReportData = {
  weekStart,
  weekEndExclusive,
  nutrition: [{
    id: 'meal', user_id: 'user', eaten_at: '2026-08-27T09:00:00+03:00', meal_type: 'breakfast',
    description: 'Каша, яйца и кофе', calories: 550, protein_g: 30, alcohol_units: null, created_at: '', updated_at: '',
  }],
  activity: [
    { id: 'a1', user_id: 'user', activity_date: '2026-08-25', steps: 8000, note: '', created_at: '', updated_at: '' },
    { id: 'a2', user_id: 'user', activity_date: '2026-08-26', steps: 10000, note: '', created_at: '', updated_at: '' },
  ],
  workouts: [{ id: 'w1', templateCode: 'A', title: 'Тренировка A', startedAt: '', finishedAt: '2026-08-25T18:00:00+03:00', durationMinutes: 62, sets: 12, volume: 4200, averageRir: 2, readinessMode: 'normal' }],
  measurements: [],
}

describe('weekly report', () => {
  it('uses Monday through Sunday and summarizes only recorded data', () => {
    expect(localDateKey(weekStart)).toBe('2026-08-24')
    expect(localDateKey(new Date(weekEndExclusive.getTime() - 1))).toBe('2026-08-30')
    expect(summarizeWeek(report)).toMatchObject({ steps: 18000, recordedDays: 2, averageSteps: 9000, meals: 1, workouts: 1, calories: 550, protein: 30 })
  })

  it('builds a Cyrillic PDF definition with the upload prompt and stable filename', () => {
    const serialized = JSON.stringify(buildWeeklyReportDocument(report))
    expect(serialized).toContain('Недельный отчёт')
    expect(serialized).toContain('Каша, яйца и кофе')
    expect(serialized).toContain('Оцени мою неделю для цели рекомпозиции')
    expect(serialized).toContain('не придумывая точные значения')
    expect(weeklyReportFilename(report)).toBe('trainlog-week-2026-08-24.pdf')
  })
})
