import type { TableRow } from '../types/trainingDatabase'
import { supabase } from './supabase'
import { localDate } from './date'

export type CardioSession = TableRow<'cardio_sessions'>
export const CARDIO_CHANGED_EVENT = 'dostigator:cardio-changed'
export const cardioKinds: Record<CardioSession['kind'], string> = {
  walk: 'Ходьба под уклоном', bike: 'Велотренажёр', elliptical: 'Эллипс', outdoor: 'Быстрая прогулка', other: 'Другое кардио',
}

function readRecords(key: string): CardioSession[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

const cacheKey = (userId: string) => `trainlog:cardio:${userId}`
const queueKey = (userId: string) => `trainlog:cardio-queue:${userId}`
export const getCardioQueue = (userId: string) => readRecords(queueKey(userId)).filter((item) => item.user_id === userId)
export const getCachedCardio = (userId: string) => mergeCardio(readRecords(cacheKey(userId)).filter((item) => item.user_id === userId), getCardioQueue(userId))

export function mergeCardio(remote: CardioSession[], pending: CardioSession[]) {
  const sessions = new Map(remote.map((session) => [session.id, session]))
  for (const session of pending) sessions.set(session.id, session)
  return [...sessions.values()].sort((first, second) => second.activity_date.localeCompare(first.activity_date) || second.created_at.localeCompare(first.created_at))
}

export function validateCardio(session: CardioSession): string | null {
  const date = new Date(`${session.activity_date}T12:00:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.activity_date) || Number.isNaN(date.getTime()) || localDate(date) !== session.activity_date || session.activity_date > localDate()) return 'Укажи корректную дату кардио не позже сегодняшней'
  if (!(session.kind in cardioKinds)) return 'Выбери вид кардио'
  if (!Number.isInteger(session.duration_minutes) || session.duration_minutes < 1 || session.duration_minutes > 1440) return 'Время: целое число от 1 до 1440 минут'
  if (session.distance_km !== null && (!Number.isFinite(session.distance_km) || session.distance_km <= 0 || session.distance_km > 1000 || Math.abs(session.distance_km * 100 - Math.round(session.distance_km * 100)) > 0.000001)) return 'Дистанция: от 0,01 до 1000 км, до двух знаков после запятой'
  if (session.effort !== null && (!Number.isInteger(session.effort) || session.effort < 1 || session.effort > 10)) return 'Усилие: целое число от 1 до 10'
  if (session.average_pulse !== null && (!Number.isInteger(session.average_pulse) || session.average_pulse < 30 || session.average_pulse > 250)) return 'Пульс: целое число от 30 до 250'
  if (session.note.length > 4000) return 'Заметка: не больше 4000 символов'
  return null
}

function notifyCardio(userId: string) {
  window.dispatchEvent(new CustomEvent(CARDIO_CHANGED_EVENT, { detail: { userId } }))
}

export function enqueueCardio(session: CardioSession) {
  const error = validateCardio(session)
  if (error) throw new Error(error)
  const queue = getCardioQueue(session.user_id).filter((item) => item.id !== session.id)
  localStorage.setItem(queueKey(session.user_id), JSON.stringify([...queue, session]))
  notifyCardio(session.user_id)
}

export async function loadCardio(userId: string) {
  const { data, error } = await supabase.from('cardio_sessions').select('*').eq('user_id', userId).order('activity_date', { ascending: false }).order('created_at', { ascending: false })
  if (error) throw new Error(`Не удалось загрузить журнал кардио: ${error.message}`)
  const records = (data ?? []) as CardioSession[]
  localStorage.setItem(cacheKey(userId), JSON.stringify(records))
  return mergeCardio(records, getCardioQueue(userId))
}

const runningSync = new Map<string, Promise<void>>()

export function syncCardio(userId: string): Promise<void> {
  const existing = runningSync.get(userId)
  if (existing) return existing
  const sync = async () => {
    while (navigator.onLine) {
      const session = getCardioQueue(userId)[0]
      if (!session) return
      const validation = validateCardio(session)
      if (validation) throw new Error(validation)
      const { error } = await supabase.from('cardio_sessions').upsert(session, { onConflict: 'id' })
      if (error) throw new Error(`Не удалось синхронизировать кардио: ${error.message}`)
      const cache = mergeCardio(readRecords(cacheKey(userId)), [session])
      localStorage.setItem(cacheKey(userId), JSON.stringify(cache))
      const queue = getCardioQueue(userId).filter((item) => item.id !== session.id || item.updated_at !== session.updated_at)
      localStorage.setItem(queueKey(userId), JSON.stringify(queue))
      notifyCardio(userId)
    }
  }
  const promise = sync().finally(() => runningSync.delete(userId))
  runningSync.set(userId, promise)
  return promise
}
