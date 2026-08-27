import { supabase } from './supabase'
import type { AppData, Area, PersonalBackup } from '../types'

const emptyData = (): AppData => ({ areas: [], goals: [], actions: [], habits: [], checkins: [], reviews: [] })

const defaultAreas = [
  { name: 'Личное развитие', color: '#ffc857', icon: 'sparkles' },
  { name: 'Дом и ремонт', color: '#8bd3dd', icon: 'home' },
  { name: 'Автомобиль', color: '#f28f8f', icon: 'car' },
  { name: 'Финансы', color: '#8ed081', icon: 'wallet' },
  { name: 'Семья', color: '#d7aefb', icon: 'heart' },
  { name: 'Здоровье', color: '#ff9f68', icon: 'activity' },
] as const

function unwrap<T>(result: { data: T | null; error: { message: string } | null }) {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function ensureAreas() {
  const current = unwrap(await supabase.from('dostigator_areas').select('*').is('archived_at', null).order('position')) ?? []
  if (current.length) return current
  const timestamp = new Date().toISOString()
  const rows = defaultAreas.map((item, position) => ({
    id: crypto.randomUUID(),
    ...item,
    position,
    archived_at: null,
    updated_at: timestamp,
  }))
  const result = await supabase.from('dostigator_areas').upsert(rows, { onConflict: 'user_id,name' }).select('*')
  return unwrap(result) ?? []
}

export async function loadAppData(): Promise<AppData> {
  const areas = await ensureAreas()
  const [goals, actions, habits, checkins, reviews] = await Promise.all([
    supabase.from('dostigator_goals').select('*').neq('status', 'archived').order('updated_at', { ascending: false }),
    supabase.from('dostigator_actions').select('*').neq('status', 'cancelled').order('created_at'),
    supabase.from('dostigator_habits').select('*').order('created_at'),
    supabase.from('dostigator_habit_checkins').select('*').order('checked_on', { ascending: false }),
    supabase.from('dostigator_weekly_reviews').select('*').order('week_start', { ascending: false }),
  ])
  return {
    areas,
    goals: unwrap(goals) ?? [],
    actions: unwrap(actions) ?? [],
    habits: unwrap(habits) ?? [],
    checkins: unwrap(checkins) ?? [],
    reviews: unwrap(reviews) ?? [],
  }
}

export function cacheData(userId: string, data: AppData) {
  localStorage.setItem(`dostigator:cache:${userId}`, JSON.stringify(data))
}

export function readCachedData(userId: string): AppData {
  try {
    const parsed = JSON.parse(localStorage.getItem(`dostigator:cache:${userId}`) ?? 'null') as Partial<AppData> | null
    if (!parsed) return emptyData()
    return {
      areas: parsed.areas ?? [], goals: parsed.goals ?? [], actions: parsed.actions ?? [],
      habits: parsed.habits ?? [], checkins: parsed.checkins ?? [], reviews: parsed.reviews ?? [],
    }
  } catch {
    return emptyData()
  }
}

export function makeBackup(data: AppData): PersonalBackup {
  return { product: 'dostigator', version: 1, exportedAt: new Date().toISOString(), data }
}

export function isBackup(value: unknown): value is PersonalBackup {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PersonalBackup>
  return item.product === 'dostigator' && item.version === 1 && !!item.data && Array.isArray(item.data.goals)
}

export function stripOwnership<T extends { user_id: string }>(row: T): Omit<T, 'user_id'> {
  const { user_id: _ignored, ...safe } = row
  return safe
}

export async function importBackup(backup: PersonalBackup) {
  const tables = [
    ['dostigator_areas', backup.data.areas],
    ['dostigator_goals', backup.data.goals],
    ['dostigator_actions', backup.data.actions],
    ['dostigator_habits', backup.data.habits],
    ['dostigator_habit_checkins', backup.data.checkins],
    ['dostigator_weekly_reviews', backup.data.reviews],
  ] as const
  for (const [table, rows] of tables) {
    if (!rows.length) continue
    const { error } = await supabase.from(table).upsert(rows.map((row) => stripOwnership(row)) as never)
    if (error) throw new Error(error.message)
  }
}

export function areaFor(areas: Area[], areaId: string | null) {
  return areas.find((item) => item.id === areaId)
}
