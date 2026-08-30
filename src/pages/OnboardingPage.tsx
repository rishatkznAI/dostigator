import { Check, Focus, Plus, Rocket, Target } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { GoalForm } from '../components/GoalForm'
import { PageHeader } from '../components/PageHeader'
import { useData } from '../context/DataContext'
import { useOnboarding } from '../context/OnboardingContext'
import { dailyFocus } from '../lib/focus'

export function OnboardingPage() {
  const { data, addAction, toggleFocus, isMutating } = useData()
  const { complete, skip } = useOnboarding()
  const navigate = useNavigate()
  const [showGoalForm, setShowGoalForm] = useState(false)
  const [actionTitle, setActionTitle] = useState('')
  const [actionSaving, setActionSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [focusSavingId, setFocusSavingId] = useState<string | null>(null)
  const goal = data.goals.find((item) => item.status === 'active') ?? data.goals[0]
  const goalActions = goal ? data.actions.filter((item) => item.goal_id === goal.id && item.status === 'todo') : []
  const focusState = dailyFocus(data.actions)
  const focusReady = focusState.usedSlots > 0
  const goalBusy = isMutating('goal-add')
  const actionBusy = actionSaving || (goal ? isMutating('action-add', goal.id) : false)
  const focusBusy = focusSavingId !== null || isMutating('focus')
  const anyBusy = goalBusy || actionBusy || focusBusy

  const submitAction = async (event: FormEvent) => {
    event.preventDefault()
    if (!goal || actionBusy) return
    setActionSaving(true); setActionError(null)
    try { await addAction(goal.id, actionTitle); setActionTitle('') }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Действие не сохранено. Попробуйте ещё раз.') }
    finally { setActionSaving(false) }
  }

  const chooseFocus = async (id: string) => {
    if (focusBusy) return
    setFocusSavingId(id)
    try { await toggleFocus(id) } catch { /* AppShell announces the single global error. */ }
    finally { setFocusSavingId(null) }
  }

  const skipFlow = () => { if (!anyBusy) { skip(); navigate('/') } }
  const finish = () => { if (!anyBusy) { complete(); navigate('/') } }

  return <div className="page onboarding-page">
    <PageHeader eyebrow="Первый результат" title="Начнём без перегруза" text="Одна цель, один конкретный шаг и место для него в сегодняшнем фокусе." />
    <section className="onboarding-explainer">
      <Focus /><div><strong>Как работает «Фокус 3»</strong><p>На день можно выбрать максимум три действия. Выполненное дело остаётся занятым слотом до завтра — список не разрастается по ходу дня.</p></div>
    </section>

    {!goal && <section className="onboarding-card"><span className="onboarding-step">1 из 3</span><Target /><h2>Создайте первую цель</h2><p>Сформулируйте результат, который хотите получить, а не просто занятие.</p><button className="primary-button" disabled={goalBusy} aria-busy={goalBusy} onClick={() => setShowGoalForm(true)}><Plus />Создать цель</button></section>}

    {goal && (actionSaving || goalActions.length === 0) && <section className="onboarding-card"><span className="onboarding-step">2 из 3</span><Rocket /><h2>Добавьте следующий шаг</h2><p>Что можно физически сделать, чтобы продвинуть цель «{goal.title}»?</p><form className="stack-form" onSubmit={submitAction}><label>Первое действие<input autoFocus required maxLength={240} value={actionTitle} onChange={(event) => setActionTitle(event.target.value)} placeholder="Например, позвонить мастеру" /></label>{actionError && <p className="form-message error" role="alert">{actionError}</p>}<button className="primary-button" disabled={actionBusy || !actionTitle.trim()} aria-busy={actionBusy}>{actionBusy ? 'Сохраняем…' : 'Сохранить действие'}</button></form></section>}

    {goal && goalActions.length > 0 && (!focusReady || focusBusy) && <section className="onboarding-card"><span className="onboarding-step">3 из 3</span><Focus /><h2>Поставьте действие в фокус</h2><p>Выберите одно главное дело на сегодня. После надёжного сохранения оно появится на главном экране.</p><div className="onboarding-actions">{goalActions.slice(0, 3).map((action) => { const busy = focusBusy || isMutating('action', action.id); return <button key={action.id} type="button" disabled={busy} aria-busy={busy} onClick={() => void chooseFocus(action.id)}><span>{action.title}</span>{focusSavingId === action.id ? 'Сохраняем…' : 'Выбрать'}</button> })}</div></section>}

    {goal && focusReady && !focusBusy && <section className="onboarding-card complete"><span className="onboarding-step">Готово</span><Check /><h2>Первый фокус собран</h2><p>На главном экране всегда видно три места дня и реальный прогресс: выполнено от 0 до 3.</p><button className="primary-button" onClick={finish}>Перейти к сегодняшнему дню</button></section>}

    <button className="onboarding-skip" type="button" disabled={anyBusy} onClick={skipFlow}>Пропустить — можно вернуться в профиле</button>
    {showGoalForm && <GoalForm onClose={() => setShowGoalForm(false)} onCreated={() => setShowGoalForm(false)} />}
  </div>
}
