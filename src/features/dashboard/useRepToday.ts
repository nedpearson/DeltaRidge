import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export interface RepTodayData {
  nextAppointment: { time: string, address: string } | null
  followUpsDue: number
  activeCampaign: string | null
  recommendedDoors: number
  nextBestAction: {
    id: string
    address: string
    distanceMiles: number | null
    score: number
    roofAge: string | null
    stormEvidence: string | null
  } | null
}

export function useRepToday() {
  const [data, setData] = useState<RepTodayData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setLoading(false)
        return
      }

      // 1. Next appointment
      const { data: appts } = await supabase
        .from('activities')
        .select('created_at, lead_id, leads(address)')
        .eq('type', 'appointment')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)

      const nextAppointment = appts?.[0] ? {
        time: new Date(appts[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        address: (appts[0].leads as any)?.address || 'Unknown address'
      } : null

      // 2. Follow-ups
      const { count: followUps } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'follow_up')
        // ideally we would filter by assigned rep, but leads table doesn't have an explicit rep_id currently, assignments are via routes

      // 3. Recommended doors (open leads with high score)
      const { count: doors } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open')
        .gte('score', 70)

      // 4. Next Best Action (Highest score open lead)
      const { data: bestLead } = await supabase
        .from('leads')
        .select('*')
        .eq('status', 'open')
        .order('score', { ascending: false })
        .limit(1)

      const nextBestAction = bestLead?.[0] ? {
        id: bestLead[0].id,
        address: bestLead[0].address,
        distanceMiles: null, // GPS distance would be calculated client-side
        score: bestLead[0].score,
        roofAge: null, // Ideally joined from properties
        stormEvidence: null // Ideally joined from storms
      } : null

      setData({
        nextAppointment,
        followUpsDue: followUps || 0,
        activeCampaign: null, // Placeholder until campaigns are fully wired
        recommendedDoors: doors || 0,
        nextBestAction
      })
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}
