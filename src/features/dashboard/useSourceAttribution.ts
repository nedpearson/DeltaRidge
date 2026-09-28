import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'

export interface SourceData {
  name: string
  appts: number
  closeRate: string
  revenue: string
  gp: string
  gpPerOpp: string
}

export function useSourceAttribution() {
  const [data, setData] = useState<SourceData[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }

      // Query real tables
      const { data: sources } = await supabase.from('lead_sources').select('id, name')
      const { data: leads } = await supabase.from('leads').select('id, lead_source_id')
      const { data: handoffs } = await supabase.from('office_handoffs').select('lead_id, status, contract_value')
      
      const sourceMap = new Map<string, { opps: number, appts: number, won: number, rev: number, name: string }>()
      
      sources?.forEach(s => {
        sourceMap.set(s.id, { opps: 0, appts: 0, won: 0, rev: 0, name: s.name })
      })

      const fallbackSourceId = 'unattributed'
      sourceMap.set(fallbackSourceId, { opps: 0, appts: 0, won: 0, rev: 0, name: 'Other / Unattributed' })

      leads?.forEach(l => {
        const sid = l.lead_source_id || fallbackSourceId
        if (!sourceMap.has(sid)) {
           sourceMap.set(sid, { opps: 0, appts: 0, won: 0, rev: 0, name: 'Unknown' })
        }
        
        const stats = sourceMap.get(sid)!
        stats.opps++
        
        const myHandoffs = handoffs?.filter(h => h.lead_id === l.id) || []
        const hasAppt = myHandoffs.length > 0 
        const hasWon = myHandoffs.some(h => h.status === 'won')
        const rev = myHandoffs.filter(h => h.status === 'won').reduce((sum, h) => sum + (h.contract_value || 0), 0)

        if (hasAppt) stats.appts++
        if (hasWon) stats.won++
        stats.rev += rev
      })

      const formatGp = (rev: number) => `$${(rev * 0.35).toLocaleString()}`
      const formatGpPerOpp = (rev: number, opps: number) => opps === 0 ? '$0' : `$${Math.round((rev * 0.35) / opps).toLocaleString()}`
      const formatCloseRate = (won: number, appt: number) => appt === 0 ? '0%' : `${Math.round((won / appt) * 100)}%`

      const result = Array.from(sourceMap.values())
        .filter(s => s.opps > 0 || s.rev > 0)
        .map(s => ({
          name: s.name,
          appts: s.appts,
          closeRate: formatCloseRate(s.won, s.appts),
          revenue: `$${s.rev.toLocaleString()}`,
          gp: formatGp(s.rev),
          gpPerOpp: formatGpPerOpp(s.rev, s.opps)
        }))
        .sort((a, b) => {
          const revA = parseFloat(a.revenue.replace(/[^0-9.-]+/g, ''))
          const revB = parseFloat(b.revenue.replace(/[^0-9.-]+/g, ''))
          return revB - revA
        })

      if (result.length === 0) {
        result.push({
          name: 'Delta Ridge Intelligence',
          appts: 0,
          closeRate: '0%',
          revenue: '$0',
          gp: '$0',
          gpPerOpp: '$0'
        })
      }

      setData(result)
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}
