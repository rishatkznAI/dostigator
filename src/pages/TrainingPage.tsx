import { Activity, ArrowRight, CloudOff, Goal, HeartPulse, History, LogOut, Play, RotateCcw, Ruler, Scale, Settings, Sparkles, TimerReset, Utensils } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTemplates } from '../hooks/useTemplates'
import { loadHistory, loadMeasurements } from '../lib/trainingRepository'
import { getActiveDraft } from '../lib/storage'
import { formatNumber, getCompletedTemplateCodesThisWeek, getNextMandatoryWorkout, getWeeklyStats, historySummary } from '../lib/workout'
import type { BodyMeasurement, HistoryWorkout } from '../types/training'

const formatDelta = (current: number | null, previous: number | null, unit: string) => {
  if (current === null || previous === null) return 'первая запись'
  const delta = current - previous
  return `${delta > 0 ? '+' : ''}${formatNumber(delta)} ${unit}`
}

const scheduleByCode: Record<string, string> = {
  A: 'Понедельник · основная',
  B: 'Среда · основная',
  C: 'Суббота · дополнительная',
}

export function TrainingPage() {
  const { user, signOut } = useAuth()
  const { templates, loading: templatesLoading, error: templatesError, refresh } = useTemplates()
  const [history, setHistory] = useState<HistoryWorkout[]>([])
  const [measurements, setMeasurements] = useState<BodyMeasurement[]>([])
  const [loading, setLoading] = useState(true)
  const [dataError, setDataError] = useState<string | null>(null)
  const active = user ? getActiveDraft(user.id) : null

  const loadDashboard = useCallback(() => {
    setLoading(true)
    setDataError(null)
    return Promise.all([loadHistory(), loadMeasurements()])
      .then(([nextHistory, nextMeasurements]) => {
        setHistory(nextHistory)
        setMeasurements(nextMeasurements)
      })
      .catch((reason: Error) => setDataError(reason.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => void loadDashboard(), [loadDashboard])

  const stats = useMemo(() => getWeeklyStats(history), [history])
  const nextMandatory = useMemo(() => getNextMandatoryWorkout(history), [history])
  const completedThisWeek = useMemo(() => getCompletedTemplateCodesThisWeek(history), [history])
  const latest = measurements[0]
  const previous = measurements[1]
  const metadataName = user?.user_metadata?.display_name
  const displayName = typeof metadataName === 'string' && metadataName.trim()
    ? metadataName.trim()
    : user?.email?.split('@')[0] ?? 'спортсмен'

  return (
    <div className="page home-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Достигатор · Тренировки</p>
          <h1>Привет, {displayName}</h1>
        </div>
        <div className="topbar-actions">
          <Link className="icon-button" to="/settings" aria-label="Настройки"><Settings size={20} /></Link>
          <button className="icon-button" type="button" onClick={() => void signOut()} aria-label="Выйти"><LogOut size={20} /></button>
        </div>
      </header>

      <nav className="training-shortcuts" aria-label="Разделы TrainLog">
        <Link to="/training/history"><History /><span>История</span></Link>
        <Link to="/nutrition"><Utensils /><span>Питание</span></Link>
        <Link to="/training/progress"><Activity /><span>Прогресс</span></Link>
        <Link to="/training/body"><Ruler /><span>Замеры</span></Link>
      </nav>

      <section className="week-card">
        <div className="week-card-heading">
          <div>
            <span>Текущая неделя</span>
            <strong>{stats.workouts} {stats.workouts === 1 ? 'тренировка' : 'тренировки'}</strong>
          </div>
          <div className="week-ring"><span>{Math.min(stats.workouts, 3)}</span>/3</div>
        </div>
        <div className="stats-grid">
          <div><strong>{stats.sets}</strong><span>рабочих подходов</span></div>
          <div><strong>{formatNumber(stats.volume)}</strong><span>кг тоннажа</span></div>
        </div>
      </section>

      <Link className="goal-card" to="/nutrition">
        <div className="goal-icon"><Goal /></div>
        <div>
          <span>Цель · рекомпозиция</span>
          <strong>Первый этап — 90 кг</strong>
          <small>2300–2400 ккал · 150–160 г белка</small>
        </div>
        <ArrowRight />
      </Link>

      {dataError && (
        <button className="error-card" type="button" onClick={() => void loadDashboard()}>
          {dataError} <RotateCcw size={18} />
        </button>
      )}

      {active && (
        <Link className="resume-card" to={`/training/workout/${active.templateCode}`}>
          <div className="resume-icon"><TimerReset /></div>
          <div><span>Активная тренировка</span><strong>{active.title}</strong></div>
          <ArrowRight />
        </Link>
      )}

      <section className="section-block">
        <div className="section-heading">
          <div><p className="eyebrow">Твоя программа</p><h2>Начать тренировку</h2></div>
          {!navigator.onLine && <span className="offline-pill"><CloudOff size={14} /> офлайн</span>}
        </div>

        {(templatesError) && (
          <button className="error-card" type="button" onClick={() => void refresh()}>
            {templatesError} <RotateCcw size={18} />
          </button>
        )}
        <div className="template-list" aria-busy={templatesLoading}>
          {templates.map((template) => {
            const recommended = template.code === nextMandatory
            const completed = completedThisWeek.has(template.code)
            const lastWorkout = history.find((workout) => workout.templateCode === template.code)
            return (
            <article className={`template-card ${recommended ? 'recommended' : ''}`} key={template.code}>
              <div className="template-code">{template.code}</div>
              <div className="template-copy">
                <h3>Тренировка {template.code} {recommended && <span className="today-badge">Следующая</span>} {completed && <span className="done-badge">Готово</span>}</h3>
                <p>{template.title}</p>
                <div className="template-meta">
                  <span>{scheduleByCode[template.code] ?? 'По плану'}</span>
                  <span>{template.items.length} упражнений · {template.items.reduce((sum, item) => sum + item.setCount, 0)} подходов</span>
                </div>
                {lastWorkout && <div className="template-last-result">Прошлый раз · {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(lastWorkout.finishedAt))} · {historySummary(lastWorkout).sets} рабочих подходов</div>}
              </div>
              <Link className="start-button" to={`/training/workout/${template.code}`} aria-label={`Начать тренировку ${template.code}`}>
                <Play size={18} fill="currentColor" />
              </Link>
            </article>
          )})}
        </div>

        <Link className="cardio-entry-card" to="/training/cardio">
          <div className="cardio-entry-icon"><HeartPulse /></div>
          <div>
            <span>Кардио</span>
            <strong>Записать кардио и заметку</strong>
            <small>Прошлый результат, время, дистанция и самочувствие</small>
          </div>
          <ArrowRight />
        </Link>

        <Link className="spa-entry-card" to="/training/spa">
          <div className="spa-entry-icon"><Sparkles /></div>
          <div>
            <span>После тренировки</span>
            <strong>Спа и восстановление</strong>
            <small>Сауна, хаммам, джакузи, бассейн и безопасный порядок действий</small>
          </div>
          <ArrowRight />
        </Link>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><p className="eyebrow">Состояние</p><h2>Последние замеры</h2></div><Link to="/training/body">Все</Link></div>
        <div className="measurement-preview">
          <div className="metric-card">
            <Scale size={20} />
            <span>Вес</span>
            <strong>{latest?.weight_kg ? `${formatNumber(latest.weight_kg)} кг` : '—'}</strong>
            <small>{formatDelta(latest?.weight_kg ?? null, previous?.weight_kg ?? null, 'кг')}</small>
          </div>
          <div className="metric-card">
            <span className="waist-icon">↔</span>
            <span>Талия</span>
            <strong>{latest?.waist_cm ? `${formatNumber(latest.waist_cm)} см` : '—'}</strong>
            <small>{formatDelta(latest?.waist_cm ?? null, previous?.waist_cm ?? null, 'см')}</small>
          </div>
        </div>
      </section>
      {loading && <div className="inline-loader">Обновляем данные…</div>}
    </div>
  )
}
