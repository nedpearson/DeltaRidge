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

      // 1. Fetch leads and handoffs to figure out "source" roughly. 
      // Right now, leads don't explicitly have a `source` column, but they have `reasons` array.
      // Let's approximate based on reasons array containing "Neighbor" or "Intelligence" etc.
      // If we don't have enough data, we'll return a server-backed array that dynamically computes based on what is available.
      
      const { data: leads } = await supabase.from('leads').select('id, reasons')
      const { data: handoffs } = await supabase.from('office_handoffs').select('lead_id, status, contract_value')

      let intelligenceOpp = 0, intelligenceAppt = 0, intelligenceWon = 0, intelligenceRev = 0
      let referralOpp = 0, referralAppt = 0, referralWon = 0, referralRev = 0
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let totalOpp = 0, totalAppt = 0, totalWon = 0, totalRev = 0

      leads?.forEach(l => {
        totalOpp++
        const reasonsStr = (l.reasons || []).join(' ').toLowerCase()
        const isReferral = reasonsStr.includes('neighbor') || reasonsStr.includes('referral')
        
        if (isReferral) referralOpp++
        else intelligenceOpp++ // Defaulting to intelligence for now since it's the primary engine

        const myHandoffs = handoffs?.filter(h => h.lead_id === l.id) || []
        const hasAppt = myHandoffs.length > 0 // We'll mock this: if they have a handoff they probably had an appt
        const hasWon = myHandoffs.some(h => h.status === 'won')
        const rev = myHandoffs.filter(h => h.status === 'won').reduce((sum, h) => sum + (h.contract_value || 0), 0)

        if (hasAppt) totalAppt++
        if (hasWon) totalWon++
        totalRev += rev

        if (isReferral) {
          if (hasAppt) referralAppt++
          if (hasWon) referralWon++
          referralRev += rev
        } else {
          if (hasAppt) intelligenceAppt++
          if (hasWon) intelligenceWon++
          intelligenceRev += rev
        }
      })

      const formatGp = (rev: number) => `$${(rev * 0.35).toLocaleString()}`
      const formatGpPerOpp = (rev: number, opps: number) => opps === 0 ? '$0' : `$${Math.round((rev * 0.35) / opps).toLocaleString()}`
      const formatCloseRate = (won: number, appt: number) => appt === 0 ? '0%' : `${Math.round((won / appt) * 100)}%`

      setData([
        {
          name: 'Delta Ridge Intelligence',
          appts: intelligenceAppt,
          closeRate: formatCloseRate(intelligenceWon, intelligenceAppt),
          revenue: `$${intelligenceRev.toLocaleString()}`,
          gp: formatGp(intelligenceRev),
          gpPerOpp: formatGpPerOpp(intelligenceRev, intelligenceOpp)
        },
        {
          name: 'Referrals & Neighbors',
          appts: referralAppt,
          closeRate: formatCloseRate(referralWon, referralAppt),
          revenue: `$${referralRev.toLocaleString()}`,
          gp: formatGp(referralRev),
          gpPerOpp: formatGpPerOpp(referralRev, referralOpp)
        },
        {
          name: 'Other Campaigns',
          appts: 0,
          closeRate: '0%',
          revenue: '$0',
          gp: '$0',
          gpPerOpp: '$0'
        }
      ])
      
      setLoading(false)
    }

    void load()
  }, [])

  return { data, loading }
}

