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
  nearbyOpportunities: {
    id: string
    address: string
    reason: string
  }[]
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
      // 1. Next Appointment
      // -------------------------------------------------------------------
      const nowIso = new Date().toISOString()
      const { data: appts } = await supabase
        .from('appointments')
        .select('id, scheduled_start, lead_id, status, leads(properties(address_line1))')
        .eq('assigned_to', user.id)
        .gte('scheduled_start', nowIso)
        .not('status', 'in', '("cancelled","completed","no_show")')
        .order('scheduled_start', { ascending: true })
        .limit(1)

      let nextAppointment: RepTodayData['nextAppointment'] = null
      if (appts && appts.length > 0 && appts[0]) {
        const appt = appts[0]
                const apptRecord = appt as Record<string, unknown>;
        const appointmentTime = String(apptRecord.scheduled_start);
        const leadJoin = apptRecord.leads as Record<string, unknown> | Record<string, unknown>[];
        
        let leadAddress = 'Address unavailable';
        if (typeof leadJoin === 'object' && leadJoin !== null) {
          // Because of the select format: leads(properties(address_line1))
          // leadJoin can be an array or object. Usually object since it's a many-to-one relation from leads to properties (wait, actually lead->property is a foreign key, so leads is object, properties is object)
          const actualLead = Array.isArray(leadJoin) ? leadJoin[0] : leadJoin;
          if (actualLead && actualLead.properties) {
            const propsJoin = actualLead.properties as Record<string, unknown> | Record<string, unknown>[];
            const actualProps = Array.isArray(propsJoin) ? propsJoin[0] : propsJoin;
            if (actualProps && actualProps.address_line1) {
              leadAddress = String(actualProps.address_line1);
            }
          }
        }
        
        nextAppointment = {
          time: new Date(appointmentTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          address: leadAddress || 'Address unavailable',
          confirmed: appt.status === 'confirmed',
          leadId: appt.lead_id
        }
      }

      // -------------------------------------------------------------------
      // 2. Active assignments
      // -------------------------------------------------------------------
      const { data: myAssignments } = await supabase
        .from('lead_assignments')
        .select('lead_id, reason')
        .eq('assigned_to', user.id)
        .is('unassigned_at', null)

      const assignedLeadIds = myAssignments?.map(a => a.lead_id) || []

      // -------------------------------------------------------------------
      // 3. Follow-ups due
      // -------------------------------------------------------------------
      let followUps = 0
      if (assignedLeadIds.length > 0) {
        const { count } = await supabase
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('status', ['attempted', 'proposal_pending'])
          .in('id', assignedLeadIds)
        followUps = count ?? 0
      }

      // -------------------------------------------------------------------
      // 4. Recommended doors
      // -------------------------------------------------------------------
      let doors = 0
      interface AssignedLead { id: string; address: string; score: number }
      let myAssignedLeads: AssignedLead[] = []
      if (assignedLeadIds.length > 0) {
        const { count, data: leads } = await supabase
          .from('leads')
          .select('id, opportunity_score, properties(address_line1)', { count: 'exact' })
          .in('status', ['untouched', 'target'])
          .in('id', assignedLeadIds)
          .order('opportunity_score', { ascending: false })

        doors = count ?? 0
        myAssignedLeads = (leads ?? []).map((l: any) => {
          let addr = 'Address unknown';
          if (l.properties) {
            const props = Array.isArray(l.properties) ? l.properties[0] : l.properties;
            if (props?.address_line1) addr = props.address_line1;
          }
          return { id: l.id, address: addr, score: l.opportunity_score || 0 };
        })
      }

      // -------------------------------------------------------------------
      // 5. Next Best Action & Nearby
      // -------------------------------------------------------------------
      let nextBestAction: RepTodayData['nextBestAction'] = null
      let nearbyOpportunities: RepTodayData['nearbyOpportunities'] = []

      if (myAssignedLeads.length > 0) {
        const best = myAssignedLeads[0]
        if (best) {
          const assignmentReason = myAssignments?.find(a => a.lead_id === best.id)?.reason
          nextBestAction = {
            id: best.id,
            address: best.address,
            distanceMiles: null,
            score: best.score,
            roofAge: null,
            stormEvidence: null,
            reason: assignmentReason || 'Highest-scored assigned lead'
          }
        }
        
        nearbyOpportunities = myAssignedLeads.slice(0, 3).map(lead => {
          const r = myAssignments?.find(a => a.lead_id === lead.id)?.reason
          return {
             id: lead.id,
             address: lead.address,
             reason: r || 'Target Lead'
          }
        })
      }

      setData({
        nextAppointment,
        followUpsDue: followUps,
        activeCampaign: null,
        recommendedDoors: doors,
        nextBestAction,
        nearbyOpportunities
      })
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}
