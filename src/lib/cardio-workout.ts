import { emptyCardioDetails, type CardioDetails } from './cardio-details'
import { localDate } from './date'
import { createId } from './workout'
import type { CardioSession } from './cardio'

export type CardioDraft = CardioDetails & {
  baseRevision?: number
  baseUpdatedAt?: string
  precisionKnown?: boolean
  id: string
  userId: string
  phase: 'ready' | 'running' | 'paused' | 'review' | 'manual' | 'saved'
  kind: CardioSession['kind']
  date: string
  goalMinutes: number | null
  minutes: string
  seconds: string
  workoutId: string | null
  distance: string
  pulse: string
  effort: string
  note: string
  elapsedMs: number
  startedAt: number | null
  editing: boolean
  createdAt: string | null
  savedAt: string | null
  updatedAt: number
}

export const cardioDraftKey = (userId: string) => `trainlog:cardio-draft:${userId}`

export function newCardioDraft(userId: string, kind: CardioSession['kind'] = 'walk', workoutId: string | null = null): CardioDraft {
  return { ...emptyCardioDetails(), id: createId(), userId, phase: 'ready', kind, date: localDate(), goalMinutes: null, minutes: '', seconds: '0', workoutId, distance: '', pulse: '', effort: '', note: '', elapsedMs: 0, startedAt: null, editing: false, createdAt: null, savedAt: null, updatedAt: Date.now() }
}

export function loadCardioDraft(userId: string): CardioDraft {
  try {
    const stored: CardioDraft = JSON.parse(localStorage.getItem(cardioDraftKey(userId)) ?? 'null')
    if (stored?.userId === userId && ['ready', 'running', 'paused', 'review', 'manual', 'saved'].includes(stored.phase) && Number.isFinite(stored.elapsedMs) && stored.elapsedMs >= 0 && (stored.startedAt === null || Number.isFinite(stored.startedAt))) return { ...emptyCardioDetails(), ...stored, seconds: stored.seconds ?? (stored.phase==='review'?String(Math.floor(stored.elapsedMs/1000)%60):'0'), workoutId: stored.workoutId ?? null, updatedAt: stored.updatedAt ?? 0 }
  } catch { return newCardioDraft(userId) }
  return newCardioDraft(userId)
}

export function saveCardioDraft(draft: CardioDraft) {
  try {
    const stored = JSON.parse(localStorage.getItem(cardioDraftKey(draft.userId)) ?? 'null')
    if (stored?.userId === draft.userId && Number.isFinite(stored.updatedAt) && stored.updatedAt > draft.updatedAt) return false
  } catch { localStorage.removeItem(cardioDraftKey(draft.userId)) }
  localStorage.setItem(cardioDraftKey(draft.userId), JSON.stringify(draft))
  return true
}

export function cardioElapsedMs(draft: CardioDraft, now = Date.now()) {
  return draft.elapsedMs + (draft.phase === 'running' && draft.startedAt !== null ? Math.max(0, now - draft.startedAt) : 0)
}

export function changeCardioTimer(draft: CardioDraft, action: 'start' | 'pause' | 'resume' | 'finish', now = Date.now()): CardioDraft {
  if (action === 'start' && draft.phase === 'ready') return { ...draft, phase: 'running', startedAt: now }
  if (action === 'resume' && draft.phase === 'paused') return { ...draft, phase: 'running', startedAt: now }
  if (action === 'pause' && draft.phase === 'running') return { ...draft, phase: 'paused', elapsedMs: cardioElapsedMs(draft, now), startedAt: null }
  if (action === 'finish' && ['running', 'paused'].includes(draft.phase)) {
    const elapsedMs = cardioElapsedMs(draft, now)
    const minutes = Math.floor(elapsedMs / 60_000)
    return { ...draft, phase: 'review', elapsedMs, startedAt: null, minutes: String(minutes), seconds: String(Math.floor(elapsedMs / 1000) % 60) }
  }
  return draft
}

export function getCardioGoal(sessions: CardioSession[], kind: CardioSession['kind'], date: string, excludeId?: string, before?: string) {
  const previous = [...sessions].filter((session) => session.kind === kind && session.activity_date <= date && session.id !== excludeId && (!before || session.activity_date < date || session.created_at < before) && (session.duration_seconds ?? session.duration_minutes*60) > 0).sort((first, second) => second.activity_date.localeCompare(first.activity_date) || second.created_at.localeCompare(first.created_at))[0]
  const breakDays = previous ? (Date.parse(date) - Date.parse(previous.activity_date)) / 86400000 : 0
  const minutes = previous ? Math.max(1,previous.duration_minutes) : 15
  return { previous, minutes, reason: !previous ? 'Стартовый ориентир, можно изменить.' : previous.duration_minutes===0 ? 'Прошлый факт короче минуты. Цель можно изменить.' : breakDays >= 14 ? 'Давняя запись: ориентир по прошлому времени, можно изменить.' : 'Повтор прошлого факта, без автоприбавки.' }
}

export function cardioClock(elapsedMs: number) {
  const seconds = Math.floor(elapsedMs / 1000)
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function cardioDifference(minutes: number, previous?: CardioSession, seconds?:number) {
  if (!previous) return 'Первая запись'
  if(seconds!=null && previous.duration_seconds!=null) { const change=seconds-previous.duration_seconds;return change===0?'Столько же, сколько в прошлый раз':`${Math.abs(change)} сек ${change>0?'дольше':'короче'} прошлого занятия` }
  const difference = minutes - previous.duration_minutes
  return difference === 0 ? 'Столько же, сколько в прошлый раз' : `${Math.abs(difference)} мин ${difference > 0 ? 'дольше' : 'короче'} прошлого занятия`
}
