import { Award, CheckCircle2, Footprints, Save, Target } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ProgressRing } from '../components/ProgressRing'
import { useData } from '../context/DataContext'
import { startOfWeek, weekDates } from '../lib/date'
import { disciplineScore } from '../lib/progress'

export function ReviewPage() {
  const { data, saveReview } = useData()
  const week = startOfWeek()
  const dates = weekDates(week)
  const existing = data.reviews.find((item) => item.week_start === week)
  const [wins, setWins] = useState(existing?.wins ?? '')
  const [blockers, setBlockers] = useState(existing?.blockers ?? '')
  const [nextFocus, setNextFocus] = useState(existing?.next_focus ?? '')
  const [selfScore, setSelfScore] = useState(existing?.self_score ?? 7)
  const [message, setMessage] = useState<string | null>(null)
  const score = disciplineScore(data.actions, data.habits, data.checkins, week)
  const completedActions = data.actions.filter((item) => item.completed_at && dates.includes(item.completed_at.slice(0, 10)))
  const focused = data.actions.filter((item) => item.focus_date && dates.includes(item.focus_date))
  const focusDone = focused.filter((item) => item.status === 'done').length
  const habitDone = data.checkins.filter((item) => dates.includes(item.checked_on)).length
  const goalsDone = data.goals.filter((item) => item.completed_at && dates.includes(item.completed_at.slice(0, 10))).length
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage(null)
    try { await saveReview({ wins, blockers, next_focus: nextFocus, self_score: selfScore }); setMessage('Обзор недели сохранён') }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить обзор') }
  }
  return <div className="page review-page">
    <PageHeader eyebrow="Проверка курса" title="Обзор недели" text="Без самокритики: факты, вывод и один приоритет на следующую неделю." />
    <section className="review-score"><div><p className="eyebrow">Индекс дисциплины</p><h2>{score >= 80 ? 'Неделя результата' : score >= 50 ? 'Хорошая основа' : 'Есть куда упростить'}</h2><p>50% — фокус дня, 30% — привычки, 20% — завершённые действия.</p></div><ProgressRing value={score} label="из 100" /></section>
    <div className="review-metrics"><article><CheckCircle2 /><span>Действия</span><strong>{completedActions.length}</strong></article><article><Target /><span>Фокус</span><strong>{focusDone}/{focused.length}</strong></article><article><Footprints /><span>Привычки</span><strong>{habitDone}</strong></article><article><Award /><span>Цели</span><strong>{goalsDone}</strong></article></div>
    <form className="review-form" onSubmit={submit}>
      <div><span>01</span><label>Что получилось?<textarea maxLength={3000} placeholder="Главные победы и завершённые дела" value={wins} onChange={(event) => setWins(event.target.value)} /></label></div>
      <div><span>02</span><label>Что мешало?<textarea maxLength={3000} placeholder="Не оправдание, а наблюдение: нехватка времени, слишком большой шаг…" value={blockers} onChange={(event) => setBlockers(event.target.value)} /></label></div>
      <div><span>03</span><label>Главный фокус следующей недели<textarea maxLength={2000} placeholder="Один результат, который сильнее всего продвинет жизнь" value={nextFocus} onChange={(event) => setNextFocus(event.target.value)} /></label></div>
      <div className="self-score"><span>04</span><label>Как вы оцениваете неделю?<input aria-label="Самооценка недели" type="range" min="1" max="10" value={selfScore} onChange={(event) => setSelfScore(Number(event.target.value))} /><strong>{selfScore}/10</strong></label></div>
      {message && <p className="form-message" role="status">{message}</p>}
      <button className="primary-button"><Save />Сохранить обзор</button>
    </form>
  </div>
}
