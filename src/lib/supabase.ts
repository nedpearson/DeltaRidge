import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { loadEnv } from './env'

/**
 * Supabase client, created lazily.
 *
 * Lazily because the field app must still boot and work offline when no
 * backend is configured at all — constructing this at module scope would make
 * an env problem a blank screen instead of a banner.
 */
let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient | null {
  if (client) return client
  try {
    const env = loadEnv()
    client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      global: {
        headers: { 'x-application-name': 'delta-ridge-field' },
      },
    })
    return client
  } catch {
    return null
  }
}

export function supabaseConfigured(): boolean {
  return getSupabase() !== null
}
