import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Copy, Footprints, Pencil, Plus, Trash2, Utensils, X } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import { deleteNutritionEntry, loadDailyActivity, loadNutritionEntries, saveDailyActivity, saveNutritionEntry } from '../lib/trainingRepository'
import { createId } from '../lib/workout'
import { localDateKey, localDateTimeInput, MEAL_TYPE_LABELS, type MealType } from '../lib/week'
import type { DailyActivity, NutritionEntry } from '../types/training'

const rangeForDate = (key: string) => {
  const start = new Date(`${key}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}
const optionalNumber = (value: string) => value === '' ? null : Number(value)
const shiftDay = (key: string, amount: number) => {
  const date = new Date(`${key}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return localDateKey(date)
}
const timeForDate = (key: string) => {
  const now = new Date()
  return `${key}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export function NutritionJournal() {
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()))
  const [entries, setEntries] = useState<NutritionEntry[]>([])
  const [activity, setActivity] = useState<DailyActivity | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [mealType, setMealType] = useState<MealType>('breakfast')
  const [eatenAt, setEatenAt] = useState(() => localDateTimeInput(new Date()))
  const [description, setDescription] = useState('')
  const [calories, setCalories] = useState('')
  const [protein, setProtein] = useState('')
  const [alcohol, setAlcohol] = useState('')
  const [steps, setSteps] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingMeal, setSavingMeal] = useState(false)
  const [savingSteps, setSavingSteps] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { start, end } = rangeForDate(selectedDate)
    setLoading(true)
    try {
      const [nextEntries, nextActivity] = await Promise.all([
        loadNutritionEntries(start, end),
        loadDailyActivity(selectedDate, selectedDate),
      ])
      setEntries(nextEntries)
      setActivity(nextActivity[0] ?? null)
      setSteps(nextActivity[0]?.steps.toString() ?? '')
      setError(null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить дневник')
    } finally {
      setLoading(false)
    }
  }, [selectedDate])

  useEffect(() => {
    setEatenAt(timeForDate(selectedDate))
    setEditId(null)
    void load()
  }, [load, selectedDate])

  const resetForm = () => {
    setEditId(null)
    setDescription('')
    setCalories('')
    setProtein('')
    setAlcohol('')
    setEatenAt(timeForDate(selectedDate))
  }

  const fillForm = (entry: NutritionEntry, editing: boolean) => {
    setEditId(editing ? entry.id : null)
    setMealType(entry.meal_type as MealType)
    setDescription(entry.description)
    setCalories(entry.calories?.toString() ?? '')
    setProtein(entry.protein_g?.toString() ?? '')
    setAlcohol(entry.alcohol_units?.toString() ?? '')
    setEatenAt(editing ? localDateTimeInput(new Date(entry.eaten_at)) : timeForDate(selectedDate))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const submitMeal = async (event: FormEvent) => {
    event.preventDefault()
    if (!description.trim()) return
    setSavingMeal(true)
    setMessage(null)
    setError(null)
    try {
      const wasEditing = editId !== null
      await saveNutritionEntry({
        id: editId ?? createId(),
        eatenAt: new Date(eatenAt).toISOString(),
        mealType,
        description,
        calories: optionalNumber(calories),
        proteinG: optionalNumber(protein),
        alcoholUnits: optionalNumber(alcohol),
      })
      resetForm()
      setMessage(wasEditing ? 'Запись обновлена' : 'Приём пищи сохранён')
      await load()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить запись')
    } finally {
      setSavingMeal(false)
    }
  }

  const submitSteps = async (event: FormEvent) => {
    event.preventDefault()
    const value = Number(steps)
    if (!Number.isInteger(value) || value < 0 || value > 100000) return
    setSavingSteps(true)
    setMessage(null)
    setError(null)
    try {
      const saved = await saveDailyActivity({ id: activity?.id ?? createId(), activityDate: selectedDate, steps: value })
      setActivity(saved)
      setMessage('Шаги сохранены')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить шаги')
    } finally {
      setSavingSteps(false)
    }
  }

  const removeEntry = async (entry: NutritionEntry) => {
    if (!window.confirm(`Удалить запись «${entry.description}»?`)) return
    try {
      await deleteNutritionEntry(entry.id)
      setEntries((current) => current.filter((item) => item.id !== entry.id))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить запись')
    }
  }

  const totals = useMemo(() => entries.reduce((result, entry) => ({
    calories: result.calories + (entry.calories ?? 0),
    protein: result.protein + (entry.protein_g ?? 0),
    alcohol: result.alcohol + (entry.alcohol_units ?? 0),
  }), { calories: 0, protein: 0, alcohol: 0 }), [entries])
  const today = localDateKey(new Date())

  return (
    <div className="journal-sections">
      <section className="day-picker-card">
        <button type="button" aria-label="Предыдущий день" onClick={() => setSelectedDate(shiftDay(selectedDate, -1))}><ChevronLeft /></button>
        <label><CalendarDays /><span>День дневника</span><input type="date" max={today} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
        <button type="button" aria-label="Следующий день" disabled={selectedDate >= today} onClick={() => setSelectedDate(shiftDay(selectedDate, 1))}><ChevronRight /></button>
      </section>

      <section className="nutrition-targets">
        <div><span>Калории</span><strong>{totals.calories || '—'} <small>/ 2300–2400</small></strong><i style={{ width: `${Math.min(100, totals.calories / 24)}%` }} /></div>
        <div><span>Белок</span><strong>{totals.protein || '—'} г <small>/ 150–160</small></strong><i style={{ width: `${Math.min(100, totals.protein / 1.6)}%` }} /></div>
        {totals.alcohol > 0 && <div className="alcohol-total"><span>Алкоголь</span><strong>{totals.alcohol} порц.</strong><i style={{ width: `${Math.min(100, totals.alcohol * 25)}%` }} /></div>}
      </section>

      <section className="steps-entry-card">
        <div><Footprints /><div><p className="eyebrow">{selectedDate === today ? 'Сегодня' : 'Выбранный день'}</p><h2>Сколько шагов?</h2></div></div>
        <form onSubmit={submitSteps}><label htmlFor="daily-steps">Шаги</label><input id="daily-steps" type="number" inputMode="numeric" min="0" max="100000" step="1" placeholder="Например, 8500" value={steps} onChange={(event) => setSteps(event.target.value)} /><button className="primary-button" type="submit" disabled={savingSteps || steps === ''}>{savingSteps ? 'Сохраняем…' : 'Сохранить'}</button></form>
      </section>

      <form className="nutrition-entry-form" onSubmit={submitMeal}>
        <div className="form-heading"><div><p className="eyebrow">{editId ? 'Редактирование' : 'Дневник еды'}</p><h2>{editId ? 'Изменить запись' : 'Что вы ели?'}</h2></div>{editId ? <button type="button" className="icon-button" onClick={resetForm} aria-label="Отменить редактирование"><X /></button> : <Utensils />}</div>
        <div className="form-row"><label>Приём пищи<select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)}>{Object.entries(MEAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Когда<input type="datetime-local" value={eatenAt} onChange={(event) => setEatenAt(event.target.value)} required /></label></div>
        <label>Описание<textarea maxLength={1000} rows={3} placeholder="Например: шаурма с курицей, без картошки" value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
        <div className="form-row three-fields"><label>Калории<input type="number" inputMode="numeric" min="0" max="5000" placeholder="необязательно" value={calories} onChange={(event) => setCalories(event.target.value)} /></label><label>Белок, г<input type="number" inputMode="decimal" min="0" max="500" step="0.1" placeholder="необязательно" value={protein} onChange={(event) => setProtein(event.target.value)} /></label><label>Алкоголь, порции<input type="number" inputMode="decimal" min="0" max="100" step="0.5" placeholder="0" value={alcohol} onChange={(event) => setAlcohol(event.target.value)} /></label></div>
        <p className="journal-hint">Одна порция — примерно 330 мл пива или 150 мл вина. Точные калории указывать необязательно.</p>
        <button className="primary-button wide" type="submit" disabled={savingMeal || !description.trim()}><Plus />{savingMeal ? 'Сохраняем…' : editId ? 'Сохранить изменения' : 'Добавить приём пищи'}</button>
      </form>

      {(message || error) && (
        <div className={`nutrition-feedback ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>
          {error ? <CircleAlert aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
          <span>{error ?? message}</span>
          <button type="button" onClick={() => { setError(null); setMessage(null) }} aria-label="Закрыть уведомление"><X aria-hidden="true" /></button>
        </div>
      )}

      <section className="today-meals">
        <div className="section-heading"><div className="meals-heading-copy"><p className="eyebrow">{selectedDate === today ? 'Сегодня' : selectedDate}</p><div><h2>Записано</h2><strong className="meal-count" aria-label={`Записей: ${entries.length}`}>{entries.length}</strong></div></div></div>
        {loading ? <div className="inline-loader">Загружаем…</div> : entries.length === 0 ? <div className="nutrition-empty">Пока нет записей.</div> : (
          <div className="nutrition-entry-list">{entries.map((entry) => (
            <article key={entry.id}>
              <time>{new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(entry.eaten_at))}</time>
              <div><span>{MEAL_TYPE_LABELS[entry.meal_type as MealType] ?? 'Другое'}</span><strong>{entry.description}</strong>{(entry.calories !== null || entry.protein_g !== null || entry.alcohol_units !== null) && <small>{[entry.calories !== null ? `${entry.calories} ккал` : '', entry.protein_g !== null ? `${entry.protein_g} г белка` : '', entry.alcohol_units !== null ? `${entry.alcohol_units} порц. алкоголя` : ''].filter(Boolean).join(' · ')}</small>}</div>
              <div className="entry-actions"><button type="button" onClick={() => fillForm(entry, false)} aria-label={`Повторить: ${entry.description}`}><Copy /></button><button type="button" onClick={() => fillForm(entry, true)} aria-label={`Изменить: ${entry.description}`}><Pencil /></button><button type="button" onClick={() => void removeEntry(entry)} aria-label={`Удалить: ${entry.description}`}><Trash2 /></button></div>
            </article>
          ))}</div>
        )}
      </section>
    </div>
  )
}
