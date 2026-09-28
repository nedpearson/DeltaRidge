import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export interface RepTodayData {
  nextAppointment: {
    time: string
    address: string
    confirmed: boolean
    leadId: string | null
  } | null
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
    reason: string
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

      // -------------------------------------------------------------------
      // 1. Next Appointment — from canonical appointment time, not activity creation time.
      //    Must be: future, not cancelled, assigned to this rep.
      // -------------------------------------------------------------------
      const nowIso = new Date().toISOString()
      const { data: appts } = await supabase
        .from('appointments')
        .select('id, scheduled_start, lead_id, status, leads(address)')
        .eq('assigned_to', user.id)
        .gte('scheduled_start', nowIso)
        .not('status', 'in', '("cancelled","completed","no_show")')
        .order('scheduled_start', { ascending: true })
        .limit(1)

      let nextAppointment: RepTodayData['nextAppointment'] = null
      if (appts && appts.length > 0 && appts[0]) {
        const appt = appts[0]
        const appointmentTime = (appt as any).scheduled_start
        const leadJoin = appt.leads as any
        const leadAddress = Array.isArray(leadJoin) && leadJoin[0]
          ? (leadJoin[0] as any).address as string
          : typeof leadJoin === 'object' && leadJoin !== null
            ? (leadJoin as any).address as string
            : 'Address unavailable'
        
        nextAppointment = {
          time: new Date(appointmentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          address: leadAddress || 'Address unavailable',
          confirmed: appt.status === 'confirmed',
          leadId: appt.lead_id
        }
      }

      // -------------------------------------------------------------------
      // 2. Active assignments — the source of truth for "my work"
      // -------------------------------------------------------------------
      const { data: myAssignments } = await supabase
        .from('lead_assignments')
        .select('lead_id, reason')
        .eq('assigned_to', user.id)
        .is('unassigned_at', null)

      const assignedLeadIds = myAssignments?.map(a => a.lead_id) || []

      // -------------------------------------------------------------------
      // 3. Follow-ups due — only from my assignments
      // -------------------------------------------------------------------
      let followUps = 0
      if (assignedLeadIds.length > 0) {
        const { count } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'follow_up')
          .in('id', assignedLeadIds)
        followUps = count ?? 0
      }

      // -------------------------------------------------------------------
      // 4. Recommended doors — from my active assignment set with explicit count
      // -------------------------------------------------------------------
      let doors = 0
      interface AssignedLead { id: string; address: string; score: number }
      let myAssignedLeads: AssignedLead[] = []
      if (assignedLeadIds.length > 0) {
        const { count, data: leads } = await supabase
          .from('leads')
          .select('id, address, score', { count: 'exact' })
          .in('status', ['new', 'open'])
          .in('id', assignedLeadIds)
          .order('score', { ascending: false })

        doors = count ?? 0
        myAssignedLeads = (leads ?? []) as AssignedLead[]
      }

      // -------------------------------------------------------------------
      // 5. Next Best Action — ONLY from my assignments.
      //    Never fall back to a random global lead without GPS/territory constraint.
      // -------------------------------------------------------------------
      let nextBestAction: RepTodayData['nextBestAction'] = null
      if (myAssignedLeads.length > 0) {
        const best = myAssignedLeads[0]
        if (best) {
          const assignmentReason = myAssignments?.find(a => a.lead_id === best.id)?.reason
          nextBestAction = {
            id: best.id,
            address: best.address,
            distanceMiles: null, // Requires device GPS to compute — left null until GPS available
            score: best.score,
            roofAge: null,
            stormEvidence: null,
            reason: assignmentReason || 'Highest-scored assigned lead'
          }
        }
      }

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
