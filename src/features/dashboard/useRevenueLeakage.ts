/* eslint-disable */
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export interface LeakagePoint {
  id: string
  label: string
  count: number
  description: string
  severity: 'high' | 'medium' | 'low'
}

export function useRevenueLeakage() {
  const [data, setData] = useState<LeakagePoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) return

      // 1. Assigned > 48h, not attempted
      // status = 'open', assigned_at < now() - 2 days
      const { count: _unattempted } = await supabase
        .from('lead_assignments')
        .select('lead_id', { count: 'exact', head: true })
        .is('unassigned_at', null)
        .lt('assigned_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())
      
      // Since 'lead_assignments' doesn't easily tell us if it was attempted (activities would),
      // we'll approximate with leads that are still 'open' but were created > 48h ago
      const { count: openOld } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'open')
        .lt('created_at', new Date(Date.now() - 48 * 3600 * 1000).toISOString())

      // 2. Inspection complete, no proposal > 24h
      // For this system, an inspection exists but lead status is still 'inspecting' instead of 'proposal'
      // Or we can just mock the count if we lack a strict 'proposal' created_at timestamp
      const { count: stalledInspections } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'inspecting')
        .lt('updated_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())

      // 3. Proposals sent, no follow-up > 72h
      const { count: stalledProposals } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .in('status', ['proposal', 'negotiating'])
        .lt('updated_at', new Date(Date.now() - 72 * 3600 * 1000).toISOString())

      // 4. Won, but no handoff > 5 days
      const { count: stalledHandoffs } = await supabase
        .from('leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'won')
        .lt('updated_at', new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString())

      setData([
        {
          id: 'unattempted',
          label: 'Stalled Assignments',
          count: openOld || 0,
          description: 'Leads assigned > 48h ago but still in open status.',
          severity: 'medium'
        },
        {
          id: 'inspections',
          label: 'Missing Proposals',
          count: stalledInspections || 0,
          description: 'Inspection complete but no proposal generated in 24h.',
          severity: 'high'
        },
        {
          id: 'proposals',
          label: 'Stalled Proposals',
          count: stalledProposals || 0,
          description: 'Proposal delivered but no activity/follow-up in 72h.',
          severity: 'high'
        },
        {
          id: 'handoffs',
          label: 'Delayed Production Handoff',
          count: stalledHandoffs || 0,
          description: 'Contract won but not handed over to production within 5 days.',
          severity: 'high'
        }
      ])
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}




