import { describe, expect, it } from 'vitest'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const tables = [
  'dostigator_areas', 'dostigator_goals', 'dostigator_actions',
  'dostigator_habits', 'dostigator_habit_checkins', 'dostigator_weekly_reviews',
]

describe.skipIf(!url || !key)('remote anonymous boundary', () => {
  it.each(tables)('blocks anonymous reads from %s', async (table) => {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    expect([401, 403]).toContain(response.status)
  })
})
