/* eslint-disable */
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
    reason?: string
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
        address: (appts[0].leads as /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ any)?.address || 'Unknown address'
      } : null

      // Get my active assignments
      const { data: myAssignments } = await supabase
        .from('lead_assignments')
        .select('lead_id, reason')
        .eq('assigned_to', user.id)
        .is('unassigned_at', null)

      const assignedLeadIds = myAssignments?.map(a => a.lead_id) || []

      // 2. Follow-ups (that I am assigned to, or just general if none)
      let followUps = 0;
      if (assignedLeadIds.length > 0) {
        const { count } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'follow_up')
          .in('id', assignedLeadIds)
        followUps = count || 0
      }

      // 3. Recommended doors = My Open Assigned Doors
      let doors = 0;
      let myAssignedLeads: any[] = []
      if (assignedLeadIds.length > 0) {
        const { count, data: leads } = await supabase
          .from('leads')
          .select('id, address, score')
          .in('status', ['new', 'open'])
          .in('id', assignedLeadIds)
          .order('score', { ascending: false })
        
        doors = count || 0
        myAssignedLeads = leads || []
      }

      // 4. Next Best Action (Highest score from MY assignments first, then fallback to general highest open)
      let bestLead: any = null
      let reason = undefined
      if (myAssignedLeads.length > 0) {
        bestLead = myAssignedLeads[0]
        reason = myAssignments?.find(a => a.lead_id === bestLead.id)?.reason || 'Assigned to you by manager'
      } else {
        const { data: generalbestLead } = await supabase
          .from('leads')
          .select('id, address, score')
          .eq('status', 'open')
          .order('score', { ascending: false })
          .limit(1)
        bestLead = generalbestLead?.[0] as any
      }

      const nextBestAction = bestLead ? {
        id: bestLead.id as string,
        address: bestLead.address as string,
        distanceMiles: null,
        score: bestLead.score as number,
        roofAge: null, 
        stormEvidence: null,
        reason
      } : null

      setData({
        nextAppointment,
        followUpsDue: followUps,
        activeCampaign: null,
        recommendedDoors: doors,
        nextBestAction
      })
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}









