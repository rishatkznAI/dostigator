import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Search, X } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import { loadExerciseLibrary, loadHistory } from '../lib/trainingRepository'
import { cacheTrainingHistory, cachedTrainingHistory, mergeTrainingHistory } from '../lib/training-insights'
import { getActiveDraft, getSyncQueue } from '../lib/storage'
import { programV21Templates } from '../lib/program-v21'
import { appendExercisesToWorkout, createPersonalExercise, personalExercisesFromHistory, readPersonalExercises, savePersonalExercise, startFreeWorkout, validateFreeSelection, type CatalogItem } from '../lib/free-workout'
import type { WorkoutTemplateItem } from '../types/training'
import './ExerciseLibraryPage.css'

export function ExerciseLibraryPage() {
  const { user } = useAuth()
  return <ExerciseLibraryContent key={user?.id ?? ''} owner={user?.id ?? ''} />
}

function ExerciseLibraryContent({ owner }: { owner: string }) {
  const navigate = useNavigate()
  const storageKey = `trainlog:exercise-selection:${owner}`
  const [selected, setSelected] = useState<WorkoutTemplateItem[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); if (saved.length) validateFreeSelection(saved); return Array.isArray(saved) ? saved : [] } catch { return [] }
  })
  const [catalog, setCatalog] = useState<CatalogItem[]>(() => readPersonalExercises(owner))
  const [query, setQuery] = useState('')
  const [onlyPersonal, setOnlyPersonal] = useState(false)
  const [title, setTitle] = useState(() => { try { return localStorage.getItem(`${storageKey}:title`) ?? 'Свободная тренировка' } catch { return 'Свободная тренировка' } })
  const [name, setName] = useState('')
  const [muscles, setMuscles] = useState('')
  const [hint, setHint] = useState('')
  const [timed, setTimed] = useState(false)
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [historyNotice, setHistoryNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const selectionRef = useRef<HTMLElement>(null)
  const createRef = useRef<HTMLDetailsElement>(null)
  const active = owner ? getActiveDraft(owner) : null

  useEffect(() => {
    let mounted = true
    const cached = mergeTrainingHistory(cachedTrainingHistory(owner), getSyncQueue(owner))
    void (async () => {
      const known = await loadExerciseLibrary()
      const targets = new Map(programV21Templates.flatMap(t => t.items.map(item => [item.exercise.key, item.repTarget] as const)))
      const buildCatalog = (history: typeof cached) => {
        const entries = [...known.map(exercise => ({ exercise, target: targets.get(exercise.key) ?? '8–12' })), ...readPersonalExercises(owner), ...personalExercisesFromHistory(history)]
        return [...new Map(entries.map(item => [item.exercise.key, item])).values()]
      }
      if (mounted) { setCatalog(buildCatalog(cached)); setLoading(false) }
      if (!navigator.onLine) { if (mounted) setHistoryNotice('Офлайн · доступен каталог на этом устройстве.'); return }
      try {
        const history = await loadHistory(500)
        if (mounted) { cacheTrainingHistory(owner, history); setCatalog(buildCatalog(mergeTrainingHistory(history, getSyncQueue(owner)))); setHistoryNotice('Свои упражнения из сохранённой истории добавлены в каталог.') }
      } catch { if (mounted) setHistoryNotice('История недоступна · показаны упражнения на этом устройстве.') }
    })().catch(() => { if (mounted) { setLoading(false); setMessage('Не удалось загрузить каталог. Перезагрузи страницу; твой выбор сохранён.') } })
    return () => { mounted = false }
  }, [owner])

  const updateSelection = (next: WorkoutTemplateItem[]) => {
    setSelected(next)
    setMessage('')
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { setMessage('Выбор не удалось сохранить на устройстве. Оставь страницу открытой.') }
  }
  const toggle = (item: CatalogItem) => {
    if (selected.some(row => row.exercise.key === item.exercise.key)) updateSelection(selected.filter(row => row.exercise.key !== item.exercise.key))
    else if (selected.length >= 30) setMessage('В одной тренировке — до 30 упражнений.')
    else updateSelection([...selected, { exercise: item.exercise, repTarget: item.target, setCount: 3, sortOrder: selected.length + 1 }])
  }
  const addCustom = (event: FormEvent) => {
    event.preventDefault()
    try {
      const item = { exercise: createPersonalExercise(name, muscles, hint), target: timed ? '30–45 сек' : '8–12' }
      savePersonalExercise(owner, item)
      setCatalog(rows => [...rows, item])
      toggle(item)
      setName(''); setMuscles(''); setHint(''); setQuery(''); setOnlyPersonal(false)
      setNotice(`«${item.exercise.name}» сохранено${selected.length < 30 ? ' и добавлено в состав тренировки' : '. В составе уже 30 упражнений; освободи место и выбери его из каталога'}.`)
      if (createRef.current) createRef.current.open = false
      selectionRef.current?.focus({ preventScroll: true })
      selectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось добавить упражнение.') }
  }
  const begin = (append: boolean) => {
    try {
      const draft = append ? appendExercisesToWorkout(owner, selected, active?.id ?? '') : startFreeWorkout(owner, title, selected)
      updateSelection([])
      navigate(`/training/workout/${draft.templateCode}`)
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось сохранить тренировку на устройстве.') }
  }
  const normalized = query.trim().toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
  const visible = catalog.filter(item => (!onlyPersonal || item.exercise.custom) && `${item.exercise.name} ${item.exercise.muscles.join(' ')}`.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е').includes(normalized))
  return <div className="page exercise-library-page">
    <PageHeader eyebrow="Зал · общий каталог" title="Упражнения" text="Собери тренировку на любой день или дополни текущую." />
    <Link className="back-link" to="/training">К тренировкам</Link>
    {active && <section className="library-active"><strong>Идёт: {active.title}</strong><p>Выбранные упражнения можно добавить в неё. Текущие подходы сохранятся.</p><Link to={`/training/workout/${active.templateCode}`}>Продолжить тренировку</Link></section>}
    <section ref={selectionRef} tabIndex={-1} className="library-selection" aria-label="Состав свободной тренировки">
      <h2>Выбрано упражнений: {selected.length}</h2>
      {notice && <p className="library-notice" role="status">{notice}</p>}
      {!active && <label>Название тренировки<input value={title} maxLength={100} onChange={event => { setTitle(event.target.value); try { localStorage.setItem(`${storageKey}:title`, event.target.value) } catch { setMessage('Название не удалось сохранить на устройстве.') } }} /></label>}
      {!selected.length && <p>Выбери упражнения ниже. Для начала достаточно одного.</p>}
      {selected.map((item, index) => <div className="library-selected-item" key={item.exercise.key}>
        <div className="library-selected-heading"><strong>{index + 1}. {item.exercise.name}</strong><button type="button" aria-label={`Убрать ${item.exercise.name}`} onClick={() => updateSelection(selected.filter(row => row.exercise.key !== item.exercise.key))}><X /></button></div>
        <div className="library-item-fields"><label>Подходы<input aria-label={`Подходы · ${item.exercise.name}`} type="number" min={1} max={10} value={item.setCount} onChange={event => updateSelection(selected.map((row, i) => i === index ? { ...row, setCount: Number(event.target.value) } : row))} /></label><label>Повторы или секунды<input aria-label={`План · ${item.exercise.name}`} value={item.repTarget} maxLength={30} onChange={event => updateSelection(selected.map((row, i) => i === index ? { ...row, repTarget: event.target.value } : row))} /></label></div>
      </div>)}
      <button className="primary-button" type="button" disabled={!selected.length} onClick={() => begin(Boolean(active))}>{active ? 'Добавить в текущую тренировку' : 'Начать свободную тренировку'}</button>
      <p className="entry-caption">Состав программы A/B/C не изменится. Свободное занятие попадёт в историю и статистику.</p>
    </section>
    {message && <p className="library-message" role="alert">{message}</p>}
    <details ref={createRef} className="library-create"><summary><Plus />Добавить своё упражнение</summary><form onSubmit={addCustom}>
      <label>Название упражнения<input required value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
      <label>Мышцы · необязательно<input value={muscles} maxLength={80} onChange={event => setMuscles(event.target.value)} /></label>
      <label>Подсказка по технике · необязательно<textarea value={hint} maxLength={200} onChange={event => setHint(event.target.value)} /></label>
      <label>Учёт<select value={timed ? 'seconds' : 'reps'} onChange={event => setTimed(event.target.value === 'seconds')}><option value="reps">Вес и повторения</option><option value="seconds">Время в секундах</option></select></label>
      <button className="secondary-button" type="submit">Сохранить и выбрать</button>
      <p className="entry-caption">Новое упражнение хранится на этом устройстве. После завершения тренировки его описание доступно в облачной истории.</p>
    </form></details>
    <div className="library-search"><Search aria-hidden="true" /><input aria-label="Поиск упражнений" placeholder="Название или мышцы" value={query} onChange={event => setQuery(event.target.value)} /></div>
    <label className="library-filter"><input type="checkbox" checked={onlyPersonal} onChange={event => setOnlyPersonal(event.target.checked)} />Только мои упражнения</label>
    <p className="entry-caption" role="status">{loading ? 'Загружаем каталог…' : `Найдено: ${visible.length}`}{historyNotice && ` · ${historyNotice}`}</p>
    <div className="library-results">{visible.map(item => {
      const chosen = selected.some(row => row.exercise.key === item.exercise.key)
      return <article key={item.exercise.key}><div><h2>{item.exercise.name}</h2><p>{item.exercise.muscles.join(' · ') || 'Своё упражнение'}</p><small>{item.exercise.custom ? 'Моё упражнение' : 'Из каталога'} · {item.target}</small></div><button type="button" className={chosen ? 'secondary-button selected' : 'secondary-button'} aria-pressed={chosen} aria-label={`Выбрать упражнение · ${item.exercise.name}`} onClick={() => toggle(item)}>{chosen ? 'Выбрано' : 'Выбрать'}</button></article>
    })}</div>
    {!loading && !visible.length && <p>Упражнений по этому запросу нет. Можно добавить своё выше.</p>}
  </div>
}
