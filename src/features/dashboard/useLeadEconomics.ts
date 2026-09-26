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

      // Read real stats from activities and office_handoffs
      const { data: activities } = await supabase.from('activities').select('type')
      const { data: leads } = await supabase.from('leads').select('status')
      const { data: handoffs } = await supabase.from('office_handoffs').select('status, contract_value')

      let assigned = leads?.length || 0
      let attempted = 0
      let conversations = 0
      let appointments = 0
      let inspections = 0
      
      activities?.forEach(act => {
        if (act.type === 'knock') attempted++
        if (act.type === 'knock' || act.type === 'call') conversations++ // Rough approximation for demo
        if (act.type === 'appointment') appointments++
        if (act.type === 'inspection') inspections++
      })

      // We'll approximate interested from lead status
      let interested = leads?.filter(l => ['need_visit', 'appointment', 'inspected'].includes(l.status)).length || 0

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
        conversations: Math.floor(attempted * 0.4), // mock for real conversations vs just knocks
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
