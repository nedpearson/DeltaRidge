import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import type { HeatTier } from './heat'

export type RequestStatus = 'new' | 'contacted' | 'booked' | 'dismissed'

export interface InspectionRequest {
  id: string
  lead_id: string | null
  heat_score: number
  heat_tier: HeatTier
  heat_reasons: string[]
  contact_name: string
  contact_phone: string | null
  contact_email: string | null
  address_text: string
  latitude: number | null
  longitude: number | null
  consent_given: boolean
  preferred_start: string | null
  status: RequestStatus
  created_at: string
  first_response_at: string | null
  answers: { insurance?: string; carrier?: string | null; claim?: string; damage?: string } | null
}

const COLUMNS =
  'id, lead_id, heat_score, heat_tier, heat_reasons, contact_name, contact_phone, contact_email, address_text, latitude, longitude, consent_given, preferred_start, status, created_at, first_response_at, answers'

/** Open inbound requests, hottest first. Polls so a new one shows up without a reload. */
export function useInspectionRequests(pollMs = 30_000) {
  const [items, setItems] = useState<InspectionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const supabase = getSupabase()
    if (!supabase) { setLoading(false); return }
    const { data, error: err } = await supabase
      .from('inspection_requests')
      .select(COLUMNS)
      .in('status', ['new', 'contacted'])
      .order('status', { ascending: false }) // 'new' before 'contacted'
      .order('heat_score', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(25)
    if (err) setError(err.message)
    else { setItems((data ?? []) as InspectionRequest[]); setError(null) }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), pollMs)
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [load, pollMs])

  const setStatus = useCallback(async (id: string, status: RequestStatus) => {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)).filter((r) => r.status === 'new' || r.status === 'contacted'))
    const supabase = getSupabase()
    if (!supabase) return
    const { error: err } = await supabase.from('inspection_requests').update({ status }).eq('id', id)
    if (err) { setError(err.message); void load() }
  }, [load])

  return { items, loading, error, reload: load, setStatus }
}

/** Minutes since the request came in — the speed-to-lead clock. */
export function minutesWaiting(createdAt: string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60_000))
}

/** Louisiana solicitation hours: 8am–8pm, Mon–Sat, in the rep's local time. */
export function insideLouisianaCallingHours(at: Date = new Date()): boolean {
  const h = at.getHours()
  return at.getDay() !== 0 && h >= 8 && h < 20
}
