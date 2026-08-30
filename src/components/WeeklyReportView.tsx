import { ChevronLeft, ChevronRight, Download, MessageSquareText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadWeeklyReport } from '../lib/trainingRepository'
import { downloadWeeklyReportPdf } from '../lib/weekly-report-pdf'
import { formatWeekRange, getWeekRange, localDateKey, MEAL_TYPE_LABELS, shiftWeek, summarizeWeek, weekDays, type MealType } from '../lib/week'
import type { WeeklyReportData } from '../types/training'

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const dayName = new Intl.DateTimeFormat('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })

export function WeeklyReportView() {
  const [reference, setReference] = useState(() => new Date())
  const [report, setReport] = useState<WeeklyReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const { weekStart, weekEndExclusive } = getWeekRange(reference)
  const weekStartMs = weekStart.getTime()
  const weekEndMs = weekEndExclusive.getTime()
  const currentWeekStart = getWeekRange(new Date()).weekStart
  const isCurrentWeek = weekStartMs >= currentWeekStart.getTime()

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    setReport(null)
    void loadWeeklyReport(new Date(weekStartMs), new Date(weekEndMs))
      .then((data) => { if (active) setReport(data) })
      .catch((loadError) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Не удалось собрать отчёт') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reloadTick, weekEndMs, weekStartMs])

  const download = async () => {
    if (!report) return
    setDownloading(true)
    setError(null)
    try {
      await downloadWeeklyReportPdf(report)
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'Не удалось сформировать PDF')
    } finally {
      setDownloading(false)
    }
  }

  if (loading) return <div className="inline-loader">Собираем неделю…</div>
  if (error && !report) return <div className="error-card"><span>{error}</span><button type="button" onClick={() => setReloadTick((value) => value + 1)}>Повторить</button></div>
  if (!report) return null

  const summary = summarizeWeek(report)

  return (
    <div className="weekly-report-view">
      <section className="week-picker">
        <button type="button" aria-label="Предыдущая неделя" onClick={() => setReference(shiftWeek(reference, -1))}><ChevronLeft /></button>
        <div><span>Неделя</span><strong>{formatWeekRange(weekStart, weekEndExclusive)}</strong></div>
        <button type="button" aria-label="Следующая неделя" disabled={isCurrentWeek} onClick={() => setReference(shiftWeek(reference, 1))}><ChevronRight /></button>
      </section>

      <section className="report-summary-grid" aria-label="Итоги недели">
        <div className="score-metric"><span>Оценка</span><strong>{summary.score}</strong><small>из 100</small></div>
        <div><span>Шаги</span><strong>{number.format(summary.steps)}</strong><small>ср. {number.format(summary.averageSteps)}</small></div>
        <div><span>Тренировки</span><strong>{summary.workouts}</strong><small>цель 2–3</small></div>
        <div><span>Подходы</span><strong>{summary.totalSets}</strong><small>{number.format(summary.totalVolume)} кг</small></div>
      </section>

      <section className="adherence-card">
        <div><span className={summary.completedA ? 'done' : ''}>A</span><span className={summary.completedB ? 'done' : ''}>B</span><span className={summary.completedC ? 'done optional' : 'optional'}>C</span></div>
        <p><strong>{summary.completedA && summary.completedB ? 'Обязательная программа выполнена' : 'Нужно закрыть A и B'}</strong><span>Баллы: A/B — 40, шаги — 25, дневник — 15, белок — 20.</span></p>
      </section>

      <section className="body-week-card">
        <div><span>Вес</span><strong>{summary.latestMeasurement?.weight_kg !== null && summary.latestMeasurement?.weight_kg !== undefined ? `${number.format(summary.latestMeasurement.weight_kg)} кг` : '—'}</strong><small>{summary.weightDelta === null ? 'нет сравнения' : `${summary.weightDelta > 0 ? '+' : ''}${number.format(summary.weightDelta)} кг`}</small></div>
        <div><span>Талия</span><strong>{summary.latestMeasurement?.waist_cm !== null && summary.latestMeasurement?.waist_cm !== undefined ? `${number.format(summary.latestMeasurement.waist_cm)} см` : '—'}</strong><small>{summary.waistDelta === null ? 'нет сравнения' : `${summary.waistDelta > 0 ? '+' : ''}${number.format(summary.waistDelta)} см`}</small></div>
        <div><span>Питание</span><strong>{summary.averageProtein ? `${summary.averageProtein} г белка/день` : 'без расчёта'}</strong><small>{summary.alcohol ? `${summary.alcohol} порц. алкоголя` : 'алкоголь не записан'}</small></div>
      </section>

      <section className="report-days">
        {weekDays(weekStart).map((day) => {
          const key = localDateKey(day)
          const activity = report.activity.find((item) => item.activity_date === key)
          const meals = report.nutrition.filter((item) => localDateKey(new Date(item.eaten_at)) === key)
          const workouts = report.workouts.filter((item) => localDateKey(new Date(item.finishedAt)) === key)
          return (
            <article key={key}>
              <header><strong>{dayName.format(day)}</strong><span>{activity ? `${number.format(activity.steps)} шагов` : 'шаги не указаны'}</span></header>
              {workouts.map((workout) => <p className="report-workout" key={workout.id}>{workout.title} · {workout.durationMinutes} мин · {workout.sets} подходов · {number.format(workout.volume)} кг{workout.averageRir !== null ? ` · RIR ${number.format(workout.averageRir)}` : ''}{workout.readinessMode === 'reduced' ? ' · облегчённая' : ''}</p>)}
              {meals.length ? <ul>{meals.map((meal) => <li key={meal.id}><span>{MEAL_TYPE_LABELS[meal.meal_type as MealType] ?? 'Другое'}</span>{meal.description}</li>)}</ul> : <p className="report-empty-day">Еда не записана</p>}
            </article>
          )
        })}
      </section>

      <section className="pdf-export-card">
        <MessageSquareText />
        <div><p className="eyebrow">Для анализа</p><h2>Скачайте и загрузите PDF</h2><p>Внутри будут шаги, тренировки, питание и готовый вопрос для ИИ. Никакие данные не отправляются автоматически.</p></div>
        <button className="primary-button wide" type="button" onClick={() => void download()} disabled={downloading}><Download />{downloading ? 'Формируем…' : 'Скачать PDF-отчёт'}</button>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
