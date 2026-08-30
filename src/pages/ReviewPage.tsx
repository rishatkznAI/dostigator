import { CheckCircle2, ChevronLeft, ChevronRight, Footprints, Save, Target } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { ProgressRing } from '../components/ProgressRing'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { formatWeekRange, shiftDate, startOfWeek } from '../lib/date'
import { weeklyMetrics } from '../lib/progress'

export function ReviewPage() {
  const { user } = useAuth()
  const { data, saveReview, isMutating } = useData()
  const currentWeek = startOfWeek()
  const [selectedWeek, setSelectedWeek] = useState(currentWeek)
  const existing = data.reviews.find((item) => item.week_start === selectedWeek && (!user || item.user_id === user.id))
  const [wins, setWins] = useState('')
  const [blockers, setBlockers] = useState('')
  const [nextFocus, setNextFocus] = useState('')
  const [selfScore, setSelfScore] = useState<number | null>(null)
  const [baseline, setBaseline] = useState({ week: currentWeek, wins: '', blockers: '', nextFocus: '', selfScore: null as number | null })
  const [submitting, setSubmitting] = useState(false)
  const submittingRef = useRef(false)
  const [message, setMessage] = useState<{ week: string; kind: 'success' | 'error'; text: string } | null>(null)
  const selectedWeekRef = useRef(selectedWeek)
  const hydratedWeekRef = useRef<string | null>(null)

  useEffect(() => {
    selectedWeekRef.current = selectedWeek
  }, [selectedWeek])

  useEffect(() => {
    if (hydratedWeekRef.current === selectedWeek) return
    hydratedWeekRef.current = selectedWeek
    setWins(existing?.wins ?? '')
    setBlockers(existing?.blockers ?? '')
    setNextFocus(existing?.next_focus ?? '')
    setSelfScore(existing?.self_score ?? null)
    setBaseline({
      week: selectedWeek,
      wins: existing?.wins ?? '',
      blockers: existing?.blockers ?? '',
      nextFocus: existing?.next_focus ?? '',
      selfScore: existing?.self_score ?? null,
    })
    setMessage(null)
  }, [existing?.blockers, existing?.next_focus, existing?.self_score, existing?.wins, selectedWeek])

  const liveMetrics = useMemo(
    () => weeklyMetrics(data.actions, data.habits, data.checkins, selectedWeek, undefined, user?.id, data.focusCommitments),
    [data.actions, data.checkins, data.focusCommitments, data.habits, selectedWeek, user?.id],
  )
  const metrics = existing?.metrics_snapshot ?? liveMetrics
  const saving = submitting || isMutating('review', selectedWeek)
  const dirty = baseline.week === selectedWeek && (
    wins !== baseline.wins || blockers !== baseline.blockers
    || nextFocus !== baseline.nextFocus || selfScore !== baseline.selfScore
  )
  const emptyNewReview = !existing && !wins.trim() && !blockers.trim() && !nextFocus.trim() && selfScore === null
  const canSave = dirty && !emptyNewReview

  useEffect(() => {
    if (!dirty) return
    const currentHistoryState = window.history.state as Record<string, unknown> | null
    const canGuardBrowserBack = typeof currentHistoryState?.idx === 'number'
    const guardToken = `review-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const guardUrl = window.location.href
    const guardState = canGuardBrowserBack ? { ...currentHistoryState, __dostigatorReviewGuard: guardToken } : null
    let guardAtTop = canGuardBrowserBack
    let allowBack = false
    let replayingInternalLink = false
    let pendingReplay: (() => void) | null = null
    if (guardState) window.history.pushState(guardState, '', guardUrl)
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    const guardInternalLink = (event: MouseEvent) => {
      if (replayingInternalLink || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(target instanceof HTMLAnchorElement) || target.target === '_blank' || target.hasAttribute('download')) return
      const destination = new URL(target.href, window.location.href)
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return
      if (!window.confirm('Уйти со страницы без сохранения изменений обзора?')) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      if (!guardState || !guardAtTop) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      allowBack = true
      guardAtTop = false
      pendingReplay = () => {
        pendingReplay = null
        queueMicrotask(() => {
          replayingInternalLink = true
          if (target.isConnected) target.click()
          else window.location.assign(destination.href)
          replayingInternalLink = false
        })
      }
      window.addEventListener('popstate', pendingReplay, { once: true })
      window.history.back()
    }
    const guardBrowserBack = () => {
      if (!guardAtTop || allowBack || !guardState) return
      guardAtTop = false
      if (window.confirm('Уйти со страницы без сохранения изменений обзора?')) {
        allowBack = true
        window.history.back()
      } else {
        window.history.pushState(guardState, '', guardUrl)
        guardAtTop = true
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('popstate', guardBrowserBack)
    document.addEventListener('click', guardInternalLink, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('popstate', guardBrowserBack)
      if (pendingReplay) window.removeEventListener('popstate', pendingReplay)
      document.removeEventListener('click', guardInternalLink, true)
      const state = window.history.state as Record<string, unknown> | null
      if (guardAtTop && state?.__dostigatorReviewGuard === guardToken) window.history.back()
    }
  }, [dirty])

  const moveWeek = (days: number) => {
    if (submittingRef.current || saving) return
    if (dirty && !window.confirm('Перейти к другой неделе без сохранения изменений?')) return
    setSelectedWeek((week) => shiftDate(week, days))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submittingRef.current || saving || !canSave) return
    submittingRef.current = true
    setSubmitting(true)
    const submittedWeek = selectedWeek
    setMessage(null)
    try {
      await saveReview(submittedWeek, { wins, blockers, next_focus: nextFocus, self_score: selfScore }, liveMetrics)
      if (selectedWeekRef.current === submittedWeek) {
        setBaseline({ week: submittedWeek, wins, blockers, nextFocus, selfScore })
        setMessage({ week: submittedWeek, kind: 'success', text: 'Обзор недели сохранён' })
      }
    } catch (reason) {
      if (selectedWeekRef.current === submittedWeek) setMessage({ week: submittedWeek, kind: 'error', text: reason instanceof Error ? reason.message : 'Не удалось сохранить обзор' })
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }
  return <div className="page review-page">
    <PageHeader eyebrow="Проверка курса" title="Обзор недели" text="Без самокритики: факты, вывод и один приоритет на следующую неделю." />
    <nav className="week-navigation" aria-label="Выбор недели"><button type="button" className="mini-icon" aria-label="Предыдущая неделя" disabled={saving} onClick={() => moveWeek(-7)}><ChevronLeft /></button><div><strong>{formatWeekRange(selectedWeek)}</strong><small>{selectedWeek === currentWeek ? 'Текущая неделя' : existing ? 'Сохранённый обзор' : 'Обзор ещё не заполнен'}</small></div><button type="button" className="mini-icon" aria-label="Следующая неделя" disabled={saving || selectedWeek >= currentWeek} onClick={() => moveWeek(7)}><ChevronRight /></button></nav>
    <section className="review-score"><div><p className="eyebrow">Индекс дисциплины</p><h2>{metrics.score === null ? 'Недостаточно данных' : metrics.score >= 80 ? 'Неделя результата' : metrics.score >= 50 ? 'Хорошая основа' : 'Есть куда упростить'}</h2><p>50% — фокус, 30% — привычки, 20% — недельная цель 5 действий. План растёт по дням; пустые категории исключаются, остальные веса нормализуются.</p></div>{metrics.score === null ? <div className="score-placeholder" aria-label="Индекс дисциплины: недостаточно данных"><strong>—</strong><span>нет данных</span></div> : <ProgressRing value={metrics.score} label="из 100" />}</section>
    <div className="review-metrics"><article><CheckCircle2 /><span>Действия к дате</span><strong>{metrics.actions ? `${metrics.actions.done}/${metrics.actions.target}` : 'Нет данных'}</strong></article><article><Target /><span>Фокус недели</span><strong>{metrics.focus ? `${metrics.focus.done}/${metrics.focus.committed}` : 'Не выбирался'}</strong></article><article><Footprints /><span>Привычки к дате</span><strong>{metrics.habits ? `${metrics.habits.done}/${metrics.habits.expected}` : 'Не настроены'}</strong></article></div>
    <form className="review-form" onSubmit={submit}>
      <div><span>01</span><label>Что получилось?<textarea disabled={saving} maxLength={3000} placeholder="Главные победы и завершённые дела" value={wins} onChange={(event) => { if (!submittingRef.current && !saving) setWins(event.target.value) }} /></label></div>
      <div><span>02</span><label>Что мешало?<textarea disabled={saving} maxLength={3000} placeholder="Не оправдание, а наблюдение: нехватка времени, слишком большой шаг…" value={blockers} onChange={(event) => { if (!submittingRef.current && !saving) setBlockers(event.target.value) }} /></label></div>
      <div><span>03</span><label>Главный фокус следующей недели<textarea disabled={saving} maxLength={2000} placeholder="Один результат, который сильнее всего продвинет жизнь" value={nextFocus} onChange={(event) => { if (!submittingRef.current && !saving) setNextFocus(event.target.value) }} /></label></div>
      <fieldset className="self-score" disabled={saving}><legend><span>04</span>Как вы оцениваете неделю?</legend><div>{Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <label key={value}><input disabled={saving} type="radio" name={`self-score-${selectedWeek}`} value={value} checked={selfScore === value} onChange={() => { if (!submittingRef.current && !saving) setSelfScore(value) }} /><span>{value}</span></label>)}</div><small>{selfScore === null ? 'Оценка не выбрана — это необязательно' : `Вы выбрали ${selfScore}/10`}</small></fieldset>
      {message?.week === selectedWeek && <p className="form-message" role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
      <button className="primary-button" disabled={saving || !canSave} aria-busy={saving}><Save />{saving ? 'Сохраняем…' : existing ? 'Обновить обзор' : 'Сохранить обзор'}</button>
    </form>
  </div>
}
