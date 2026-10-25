import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseProgressCharts, WeeklyProgressChart, comparableExerciseFacts, exerciseMetricPoints, exerciseProgressFacts } from './TrainingProgressCharts'
import type { HistoryWorkout, WorkoutSetDraft } from '../types/training'

const set = (id: string, weightKg: number | null = 40, reps: number | null = 10): WorkoutSetDraft => ({ id, setNumber: 1, weightKg, reps, rir: null, done: true, isWarmup: false, completedAt: null })
const workout = (id: string, day: string, sets: WorkoutSetDraft[], target = '8–12', readinessMode: HistoryWorkout['readinessMode'] = 'normal'): HistoryWorkout => ({
  id, title: 'Тестовая тренировка', templateCode: 'A', startedAt: `${day}T10:00:00Z`, finishedAt: `${day}T11:00:00Z`, timerPausedDurationMs: 0, readinessMode,
  exercises: [{ id: `exercise-${id}`, exerciseKey: 'press', exerciseName: 'Жим', target, sortOrder: 1, skipped: false, skipReason: '', sets }],
})

afterEach(cleanup)

describe('exercise chart facts', () => {
  it('keeps zero additional weight and excludes warm-up, skipped and unfinished facts', () => {
    const record = workout('one', '2026-10-20', [set('recorded', 0, 12), { ...set('warmup', 90, 20), isWarmup: true }, { ...set('undone', 100, 99), done: false }, { ...set('skipped', 200, 99), skipped: true }])
    expect(exerciseProgressFacts([record], 'press')).toMatchObject([{ weight: 0, reps: 12, sets: 1 }])
    record.exercises[0].skipped = true
    expect(exerciseProgressFacts([record], 'press')).toEqual([])
  })

  it('keeps incomplete values missing rather than substituting zero or a partial maximum/sum', () => {
    const records = [workout('weight-missing', '2026-10-19', [set('a', 40, 10), set('b', null, 8)]), workout('reps-missing', '2026-10-20', [set('c', 42.5, null), set('d', 40, 10)])]
    expect(exerciseProgressFacts(records, 'press')).toMatchObject([{ weight: null, reps: 18, sets: 2 }, { weight: 42.5, reps: null, sets: 2 }])
  })

  it('compares only matching target, readiness and recorded set count, while retaining other facts', () => {
    const records = [workout('older', '2026-10-18', [set('a'), set('b')]), workout('other-count', '2026-10-19', [set('c')]), workout('reduced', '2026-10-20', [set('d'), set('e')], '8–12', 'reduced'), workout('target', '2026-10-21', [set('f'), set('g')], '12–15'), workout('latest', '2026-10-22', [set('h', 42.5), set('i', 42.5)])]
    const facts = exerciseProgressFacts(records, 'press'), latest = facts.at(-1)!
    expect(facts.map(fact => comparableExerciseFacts(fact, latest))).toEqual([true, false, false, false, true])
    expect(exerciseMetricPoints(facts, 'weight', true).map(point => point.value)).toEqual([40, null, null, null, 42.5])
    expect(exerciseMetricPoints(facts, 'sets', false).map(point => point.value)).toEqual([2, 1, 2, 2, 2])
  })

  it('does not mix timed seconds with repetitions even when showing all conditions', () => {
    const facts = exerciseProgressFacts([workout('reps', '2026-10-19', [set('a', 0, 12)], '10–15'), workout('time', '2026-10-20', [set('b', 0, 30)], '30–45 сек')], 'press')
    expect(exerciseMetricPoints(facts, 'reps', false).map(point => point.value)).toEqual([null, 30])
    render(<ExerciseProgressCharts history={[workout('time', '2026-10-20', [set('b', 0, 30)], '30–45 сек')]} exerciseKey="press" />)
    fireEvent.click(screen.getByRole('button', { name: 'Время' }))
    expect(screen.getByRole('img', { name: /Время во всех рабочих подходах, сек/ })).toBeInTheDocument()
  })

  it('uses one workout point even if history contains a duplicate and includes repeated exercise instances', () => {
    const record = workout('one', '2026-10-20', [set('a', 40, 10)])
    record.exercises.push({ ...record.exercises[0], id: 'second-instance', sets: [set('b', 42.5, 8)] })
    expect(exerciseProgressFacts([record, record], 'press')).toMatchObject([{ weight: 42.5, reps: 18, sets: 2 }])
    expect(exerciseProgressFacts([record, record], 'press')).toHaveLength(1)
  })
})

describe('accessible charts', () => {
  it('breaks the weight line at missing values and exposes each actual value in a text list', () => {
    const records = [workout('first', '2026-10-18', [set('a', 40)]), workout('gap', '2026-10-19', [set('b', null)]), workout('latest', '2026-10-20', [set('c', 42.5)])]
    const { container } = render(<ExerciseProgressCharts history={records} exerciseKey="press" />)
    expect(container.querySelectorAll('.training-metric-dot')).toHaveLength(2)
    expect(container.querySelector('.training-metric-line')?.getAttribute('d')?.match(/M/g)).toHaveLength(2)
    fireEvent.click(screen.getByText('Значения графика', { exact: true }))
    expect(screen.getByText('Нет точки', { exact: true })).toBeInTheDocument()
    expect(screen.getByText('Значение записано не во всех рабочих подходах')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторы' }))
    expect(container.querySelectorAll('.training-metric-dot')).toHaveLength(3)
    expect(screen.getByRole('img', { name: /Повторы во всех рабочих подходах, повт/ })).toBeInTheDocument()
    expect(screen.queryByText(/тоннаж/i)).not.toBeInTheDocument()
  })

  it('keeps weekly training, set counts and exact cardio duration as separate selectable units', () => {
    render(<WeeklyProgressChart weeks={[{ from: '2026-10-19', workouts: 2, sets: 30, cardioSeconds: 1217 }, { from: '2026-10-12', workouts: 1, sets: 15, cardioSeconds: 0 }]} />)
    const group = screen.getByRole('group', { name: 'Показатель недели' })
    expect(screen.getByRole('img', { name: /Силовые тренировки по неделям, трен/ })).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Подходы' }))
    expect(screen.getByRole('img', { name: /Рабочие подходы по неделям, подх/ })).toBeInTheDocument()
    fireEvent.click(within(group).getByRole('button', { name: 'Кардио' }))
    expect(screen.getByRole('img', { name: /Время кардио по неделям, мин/ })).toBeInTheDocument()
    expect(screen.getAllByText(/20 мин 17 сек/).length).toBeGreaterThan(0)
  })
})
