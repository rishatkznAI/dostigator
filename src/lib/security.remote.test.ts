import { beforeAll, describe, expect, it } from 'vitest'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const tables = [
  'dostigator_areas', 'dostigator_goals', 'dostigator_actions',
  'dostigator_habits', 'dostigator_habit_checkins', 'dostigator_weekly_reviews',
]

describe.skipIf(!url || !key)('remote anonymous boundary', () => {
  const headers = { apikey: key, ...(key?.startsWith('sb_publishable_') ? {} : { Authorization: `Bearer ${key}` }) }
  beforeAll(async()=>{
    const control=await fetch(`${url}/auth/v1/settings`,{headers,redirect:'error',signal:AbortSignal.timeout(10000)})
    expect(control.status,'Invalid gateway/key must not count as an anonymous boundary pass').toBe(200)
  })
  it.each(tables)('blocks anonymous reads from %s', async (table) => {
    const response = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
      headers, redirect:'error', signal:AbortSignal.timeout(10000),
    })
    expect([401, 403]).toContain(response.status)
  })
})
