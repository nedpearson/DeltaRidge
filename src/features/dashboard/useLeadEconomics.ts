import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export interface EconomicsData {
  assigned: number
  attempted: number
  conversations: number
  interested: number
  appointments: number
  inspections: number
  proposals: number
  won: number
  contractValue: number
  estimatedGp: number
}

export function useLeadEconomics() {
  const [data, setData] = useState<EconomicsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data: activities } = await supabase.from('activities').select('activity_type')
      const { data: leads } = await supabase.from('leads').select('status')
      const { data: handoffs } = await supabase.from('office_handoffs').select('status, contract_value')
      const { data: callOutcomes } = await supabase.from('call_outcomes').select('outcome')

      const assigned = leads?.length || 0
      let attempted = 0
      let appointments = 0
      let inspections = 0
      
      activities?.forEach(act => {
        if (act.activity_type === 'knock' || act.activity_type === 'call') attempted++
        if (act.activity_type === 'appointment') appointments++
        if (act.activity_type === 'inspection') inspections++
      })

      let conversations = 0
      let interested = 0

      callOutcomes?.forEach(co => {
        if (co.outcome === 'spoke' || co.outcome === 'interested') conversations++
        if (co.outcome === 'interested') interested++
      })

      let proposals = 0
      let won = 0
      let contractValue = 0

      handoffs?.forEach(h => {
        if (h.status === 'proposal_sent' || h.status === 'won') proposals++
        if (h.status === 'won') {
          won++
          contractValue += (h.contract_value || 0)
        }
      })

      setData({
        assigned,
        attempted,
        conversations,
        interested,
        appointments,
        inspections,
        proposals,
        won,
        contractValue,
        estimatedGp: contractValue * 0.35 // 35% margin assumption
      })
      
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}
