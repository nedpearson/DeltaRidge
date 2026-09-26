import { getSupabase } from './supabase'

export async function trackEvent(eventName: string, data?: Record<string, any>) {
  const supabase = getSupabase()
  if (!supabase) return

  try {
    await supabase.from('analytics_events').insert({
      event_name: eventName,
      event_data: data || {}
    })
  } catch (error) {
    console.warn('Failed to track event', error)
  }
}
