export function localDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function localDateFromTimestamp(value: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : localDate(parsed)
}

export function startOfWeek(date = new Date()) {
  const value = new Date(date)
  value.setHours(12, 0, 0, 0)
  const day = value.getDay() || 7
  value.setDate(value.getDate() - day + 1)
  return localDate(value)
}

export function weekDates(weekStart = startOfWeek()) {
  const start = new Date(`${weekStart}T12:00:00`)
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return localDate(day)
  })
}

export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00`)
  date.setDate(date.getDate() + days)
  return localDate(date)
}

export function weekAsOf(weekStart: string, today = localDate()) {
  const weekEnd = shiftDate(weekStart, 6)
  if (today < weekStart) return weekStart
  return today > weekEnd ? weekEnd : today
}

export function formatWeekRange(weekStart: string) {
  const end = shiftDate(weekStart, 6)
  const format = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
  return `${format.format(new Date(`${weekStart}T12:00:00`))} — ${format.format(new Date(`${end}T12:00:00`))}`
}

export function formatDate(value: string | null) {
  if (!value) return 'Без срока'
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`))
}
