import { Download, FilePenLine, NotebookPen, Search, Trash2 } from 'lucide-react'
import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { PageHeader } from '../components/PageHeader'
import { useData } from '../context/DataContext'
import { localDate, shiftDate } from '../lib/date'
import type { JournalEntry, JournalEntryType } from '../types'

const noJournals: JournalEntry[] = []

type JournalFilter = JournalEntryType | 'all'
type Notice = { kind: 'success' | 'error'; text: string }

type TrendDay = { date: string; count: number }

const emptyString = (value: string) => value.trim().replace(/\s+/g, ' ')

const typeLabel: Record<JournalEntryType, string> = {
  idea: 'Идея',
  plan: 'План',
  'day-note': 'День',
}

function escapeCsv(value: string) {
  const safe = /^[\s]*[=+@-]/.test(value) ? `'${value}` : value
  const normalized = safe.replace(/\r\n/g, '\\n').replace(/\n/g, '\\n')
  return `"${normalized.replace(/"/g, '""')}"`
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }).format(new Date(`${value}T12:00:00`))
}

function formatDateShort(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`))
}

export function JournalPage() {
  const {
    data,
    isMutating,
    addJournalEntry,
    updateJournalEntry,
    deleteJournalEntry,
  } = useData()
  const journals = data.journals ?? noJournals

  const [typeFilter, setTypeFilter] = useState<JournalFilter>('all')
  const [dateFilter, setDateFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [journalDate, setJournalDate] = useState(() => localDate())
  const [entryType, setEntryType] = useState<JournalEntryType>('idea')
  const [message, setMessage] = useState<Notice | null>(null)
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingType, setEditingType] = useState<JournalEntryType>('idea')
  const [editingDate, setEditingDate] = useState(localDate())
  const [editingTitle, setEditingTitle] = useState('')
  const [editingContent, setEditingContent] = useState('')

  const sortedJournals = useMemo(() => {
    return [...journals].sort((a, b) => (b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)))
  }, [journals])

  const filtered = useMemo(() => {
    const normalizedQuery = emptyString(search).toLocaleLowerCase('ru-RU')
    return sortedJournals.filter((entry) => {
      if (typeFilter !== 'all' && entry.entry_type !== typeFilter) return false
      if (dateFilter !== 'all' && entry.date !== dateFilter) return false
      if (!normalizedQuery) return true
      return `${entry.title} ${entry.content}`.toLocaleLowerCase('ru-RU').includes(normalizedQuery)
    })
  }, [dateFilter, search, sortedJournals, typeFilter])

  const periodExportEntries = useMemo(() => {
    if (!exportFrom && !exportTo) return filtered
    return filtered.filter((entry) => {
      if (exportFrom && entry.date < exportFrom) return false
      if (exportTo && entry.date > exportTo) return false
      return true
    })
  }, [exportFrom, exportTo, filtered])

  const isRangeInvalid = Boolean(exportFrom && exportTo && exportFrom > exportTo)

  const dateOptions = useMemo(() => {
    return Array.from(new Set(sortedJournals.map((entry) => entry.date))).sort((a, b) => b.localeCompare(a))
  }, [sortedJournals])

  const grouped = useMemo(() => {
    const groups: Array<{ date: string; items: JournalEntry[] }> = []
    for (const entry of filtered) {
      const latest = groups.at(-1)
      if (latest && latest.date === entry.date) latest.items.push(entry)
      else groups.push({ date: entry.date, items: [entry] })
    }
    return groups
  }, [filtered])

  const analytics = useMemo(() => {
    const all = filtered.length
    const byType = {
      idea: filtered.filter((entry) => entry.entry_type === 'idea').length,
      plan: filtered.filter((entry) => entry.entry_type === 'plan').length,
      dayNote: filtered.filter((entry) => entry.entry_type === 'day-note').length,
    }
    const today = localDate()
    const trend: TrendDay[] = Array.from({ length: 7 }, (_, shift) => {
      const date = shiftDate(today, shift - 6)
      const count = journals.filter((entry) => entry.date === date).length
      return { date, count }
    })
    const max = trend.reduce((maxCount, item) => Math.max(maxCount, item.count), 0)
    return { all, byType, trend, max }
  }, [journals, filtered])

  if (!addJournalEntry || !updateJournalEntry || !deleteJournalEntry) {
    return <div className="page journal-page"><PageHeader eyebrow="Дневная рефлексия" title="Дневник" text="Временный режим не даёт доступа к редактированию дневника." /></div>
  }

  const isAdding = isMutating('journal-add')
  const isDeleting = (id: string) => isMutating('journal', id)

  const startEdit = (entry: JournalEntry) => {
    setEditingId(entry.id)
    setEditingType(entry.entry_type)
    setEditingDate(entry.date)
    setEditingTitle(entry.title)
    setEditingContent(entry.content)
    setMessage(null)
  }

  const clearEdit = () => {
    setEditingId(null)
    setEditingType('idea')
    setEditingDate(localDate())
    setEditingTitle('')
    setEditingContent('')
  }

  const submitCreate = async (event: FormEvent) => {
    event.preventDefault()
    if (isAdding) return
    const safeTitle = emptyString(title)
    const safeContent = content.trim()
    if (!safeTitle) {
      setMessage({ kind: 'error', text: 'Заголовок должен быть не пустым.' })
      return
    }
    try {
      await addJournalEntry({
        date: journalDate,
        entryType,
        title: safeTitle,
        content: safeContent,
      })
      setTitle('')
      setContent('')
      setEntryType('idea')
      setMessage({ kind: 'success', text: 'Запись сохранена. Её можно будет поправить позже.' })
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось добавить запись.' })
    }
  }

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingId) return
    const safeTitle = emptyString(editingTitle)
    if (!safeTitle) {
      setMessage({ kind: 'error', text: 'Заголовок должен быть не пустым.' })
      return
    }
    try {
      await updateJournalEntry(editingId, {
        date: editingDate,
        entry_type: editingType,
        title: safeTitle,
        content: editingContent.trim(),
      })
      setMessage({ kind: 'success', text: 'Запись обновлена.' })
      clearEdit()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось обновить запись.' })
    }
  }

  const deleteEntry = async (entry: JournalEntry) => {
    if (!window.confirm(`Удалить запись «${entry.title}»?`)) return
    try {
      await deleteJournalEntry(entry.id)
      setMessage({ kind: 'success', text: 'Запись удалена.' })
      if (editingId === entry.id) clearEdit()
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : 'Не удалось удалить запись.' })
    }
  }

  const download = (format: 'json' | 'csv', entries: JournalEntry[]) => {
    const fileName = format === 'json'
      ? `dostigator-journal-${new Date().toISOString().slice(0, 10)}.json`
      : `dostigator-journal-${new Date().toISOString().slice(0, 10)}.csv`
    const blobContent = format === 'json'
      ? JSON.stringify(entries.map(({ user_id: _owner, ...entry }) => entry), null, 2)
      : ['id,date,type,title,content,created_at,updated_at', ...entries.map((entry) => [
          escapeCsv(entry.id),
          escapeCsv(entry.date),
          escapeCsv(typeLabel[entry.entry_type]),
          escapeCsv(entry.title),
          escapeCsv(entry.content),
          escapeCsv(entry.created_at),
          escapeCsv(entry.updated_at),
        ].join(','))].join('\n')
    const mime = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
    const blob = new Blob([blobContent], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadMarkdown = (entries: JournalEntry[]) => {
    const lines = [
      '# Дневник',
      `Экспортировано записей: ${entries.length}`,
      '',
    ]
    const groups: Array<{ date: string; items: JournalEntry[] }> = []
    for (const entry of [...entries].sort((a, b) => (b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at)))) {
      const latest = groups.at(-1)
      if (latest && latest.date === entry.date) latest.items.push(entry)
      else groups.push({ date: entry.date, items: [entry] })
    }
    for (const group of groups) {
      lines.push(`## ${formatDateLabel(group.date)}`)
      for (const entry of group.items) {
        lines.push(`### ${entry.title}`)
        lines.push(`- Тип: ${typeLabel[entry.entry_type]}`)
        lines.push(`- Дата: ${formatDateShort(entry.date)}`)
        if (entry.updated_at !== entry.created_at) lines.push(`- Обновлено: ${formatDateShort(entry.updated_at.slice(0, 10))}`)
        lines.push(entry.content ? `\n> ${entry.content.replace(/\n/g, '\n> ')}` : '> *Пустая заметка*')
        lines.push('')
      }
    }
    const fileName = `dostigator-journal-${new Date().toISOString().slice(0, 10)}.md`
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  const exportEntries = (entries: JournalEntry[], kind: 'json' | 'csv' | 'md') => {
    if (!entries.length) {
      setMessage({ kind: 'error', text: 'Нет записей для экспорта по выбранным условиям.' })
      return
    }
    if (kind === 'md') downloadMarkdown(entries)
    else download(kind, entries)
    setMessage({ kind: 'success', text: `Экспорт выполнен (${entries.length} записей).` })
  }

  const handleJournalDateChange = (event: ChangeEvent<HTMLInputElement>) => {
    setJournalDate(event.target.value)
  }

  return <div className="page journal-page">
    <PageHeader eyebrow="Идеи и мысли" title="Дневник" text="Записи идей, планов и итогов дня. Оставляйте факты, затем корректируйте их вместе с тем, как меняется ваш взгляд." />
    {message && <p className="form-message" role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <section className="inline-create-card journal-analytics">
      <h2>Аналитика</h2>
      <div className="journal-analytics-grid">
        <article className="journal-analytics-card"><p>Записей всего</p><h3>{analytics.all}</h3><p>Учёт после фильтров</p></article>
        <article className="journal-analytics-card"><p>Идеи</p><h3>{analytics.byType.idea}</h3><p>Новые ходы мышления</p></article>
        <article className="journal-analytics-card"><p>Планы</p><h3>{analytics.byType.plan}</h3><p>Задачи к воплощению</p></article>
        <article className="journal-analytics-card"><p>Дни</p><h3>{analytics.byType.dayNote}</h3><p>Как прошёл день</p></article>
      </div>
      <div className="journal-trend">
        <p className="eyebrow" style={{ marginBottom: 4 }}>Движение за 7 дней</p>
        <div className="journal-trend-list">
          {analytics.trend.map((item) => <div className="journal-trend-day" key={item.date}><span>{formatDateShort(item.date)}</span>
            <span className="journal-trend-bar"><span className="journal-trend-bar-fill" style={{ width: `${analytics.max ? (item.count / analytics.max) * 100 : 0}%` }} /><span className="visually-hidden">{`${item.count} записей`}</span></span>
          </div>)}
        </div>
      </div>
      <div className="journal-toolbar-actions">
        <button type="button" className="secondary-button" onClick={() => exportEntries(filtered, 'json')}><Download />JSON (по фильтру)</button>
        <button type="button" className="secondary-button" onClick={() => exportEntries(filtered, 'csv')}><Download />CSV (по фильтру)</button>
        <button type="button" className="secondary-button" onClick={() => exportEntries(filtered, 'md')}><Download />Markdown (по фильтру)</button>
      </div>
      <div className="journal-export-range">
        <p className="journal-export-caption">Экспорт по диапазону</p>
        <div className="journal-export-period">
          <label>С даты
            <input type="date" value={exportFrom} onChange={(event) => setExportFrom(event.target.value)} />
          </label>
          <label>По дату
            <input type="date" value={exportTo} onChange={(event) => setExportTo(event.target.value)} />
          </label>
        </div>
        {isRangeInvalid && <p className="journal-export-error" role="alert">Начало периода не может быть позже конца.</p>}
        <div className="journal-toolbar-actions">
          <button type="button" className="secondary-button" onClick={() => exportEntries(periodExportEntries, 'json')} disabled={isRangeInvalid}><Download />JSON (диапазон)</button>
          <button type="button" className="secondary-button" onClick={() => exportEntries(periodExportEntries, 'csv')} disabled={isRangeInvalid}><Download />CSV (диапазон)</button>
          <button type="button" className="secondary-button" onClick={() => exportEntries(periodExportEntries, 'md')} disabled={isRangeInvalid}><Download />Markdown (диапазон)</button>
        </div>
      </div>
    </section>

    <section className="inline-create-card">
      <div className="settings-title"><NotebookPen /><div><p className="eyebrow">Новая запись</p><h2>Добавить мысль или план</h2></div></div>
      <form className="stack-form" onSubmit={submitCreate}>
        <div className="journal-filter-row">
          <label>Тип записи
            <select value={entryType} onChange={(event) => setEntryType(event.target.value as JournalEntryType)}>
              <option value="idea">Идея</option>
              <option value="plan">План</option>
              <option value="day-note">Как прошёл день</option>
            </select>
          </label>
          <label>Дата
            <input type="date" value={journalDate} onChange={handleJournalDateChange} />
          </label>
        </div>
        <label>Заголовок
          <input maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Например: Закрыть важный баг, Запланировать день" />
        </label>
        <label>Содержание
          <textarea value={content} maxLength={5000} rows={4} onChange={(event) => setContent(event.target.value)} placeholder="Коротко: что я заметил, что хочу сделать, как прошло сегодня." />
        </label>
        <button className="primary-button" disabled={isAdding} aria-busy={isAdding}>{isAdding ? 'Сохраняем…' : 'Сохранить запись'}</button>
      </form>
    </section>

    <section className="inline-create-card journal-toolbar">
      <div className="search-box"><Search aria-hidden="true" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по заголовку и тексту" /></div>
      <div className="filter-grid">
        <label htmlFor="journal-filter-type" className="form-field">Тип
          <select id="journal-filter-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as JournalFilter)}>
            <option value="all">Все</option>
            <option value="idea">Идеи</option>
            <option value="plan">Планы</option>
            <option value="day-note">Дни</option>
          </select>
        </label>
        <label htmlFor="journal-filter-date" className="form-field">Дата
          <select id="journal-filter-date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
            <option value="all">Любая дата</option>
            {dateOptions.map((item) => <option value={item} key={item}>{formatDateLabel(item)}</option>)}
          </select>
        </label>
      </div>
    </section>

    <section className="journal-list">
      {grouped.length === 0 && <p className="journal-empty">Нет записей по текущему фильтру. Добавьте первую запись выше.</p>}
      {grouped.map((group) => <section className="journal-day-group" key={group.date}>
        <h3 className="journal-day-title">{formatDateLabel(group.date)}<small>{group.items.length} записей</small></h3>
        {group.items.map((entry) => <article className="journal-entry" key={entry.id}>
          {editingId === entry.id
            ? <form className="stack-form" onSubmit={submitEdit}>
              <div className="journal-entry-form-grid">
                <label>Дата
                  <input type="date" value={editingDate} onChange={(event) => setEditingDate(event.target.value)} />
                </label>
                <label>Тип
                  <select value={editingType} onChange={(event) => setEditingType(event.target.value as JournalEntryType)}>
                    <option value="idea">Идея</option>
                    <option value="plan">План</option>
                    <option value="day-note">Как прошёл день</option>
                  </select>
                </label>
              </div>
              <label>Заголовок
                <input maxLength={180} value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} />
              </label>
              <label>Содержание
                <textarea rows={4} value={editingContent} maxLength={5000} onChange={(event) => setEditingContent(event.target.value)} />
              </label>
              <div className="journal-entry-actions">
                <button className="primary-button" disabled={isMutating('journal', entry.id)}><FilePenLine />{isMutating('journal', entry.id) ? 'Сохраняем…' : 'Сохранить'}</button>
                <button type="button" className="secondary-button" onClick={clearEdit} disabled={isMutating('journal', entry.id)}>Отмена</button>
              </div>
            </form>
            : <>
              <div className="journal-entry-header">
                <div className="journal-entry-meta">
                  <strong>{entry.title}</strong>
                  <span>{formatDateShort(entry.date)} • Обновлено: {formatDateShort(entry.updated_at.slice(0, 10))}</span>
                  <span className="journal-entry-type">{typeLabel[entry.entry_type]}</span>
                </div>
                <div className="journal-entry-actions">
                  <button type="button" className="mini-icon" onClick={() => startEdit(entry)} aria-label={`Редактировать запись ${entry.title}`}><FilePenLine /></button>
                  <button type="button" className="mini-icon danger" onClick={() => void deleteEntry(entry)} disabled={isDeleting(entry.id)} aria-label={`Удалить запись ${entry.title}`}><Trash2 /></button>
                </div>
              </div>
              <div className="journal-entry-content">{entry.content || <span className="field-hint">Пустая заметка</span>}</div>
            </>
          }
        </article>)}
      </section>)}
    </section>
  </div>
}
