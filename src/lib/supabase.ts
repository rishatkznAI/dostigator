import { createClient } from '@supabase/supabase-js'
import { trackedSupabaseFetch } from './update-safety'

const url = import.meta.env.VITE_SUPABASE_URL
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export const isSupabaseConfigured = Boolean(url && publishableKey)

export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  publishableKey || 'sb_publishable_placeholder',
  {
    global: { fetch: trackedSupabaseFetch },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
