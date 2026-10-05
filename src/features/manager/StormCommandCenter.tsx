/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

export function StormCommandCenter() {
  const [loading, setLoading] = useState(true)
  const [storms, setStorms] = useState<unknown[]>([])
  const [impactedCount, setImpactedCount] = useState(0)
  const [activeReps, setActiveReps] = useState(0)
  const [outcomes, setOutcomes] = useState({ doorsKnocked: 0, inspectionsToday: 0 })

  useEffect(() => {
    async function loadData() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }
      
      // 1. Fetch active storms
      const { data: stormData } = await supabase
        .from('storm_events')
        .select('*')
        .gte('wind_speed_mph', 60)
        .order('event_date', { ascending: false })
        .limit(10)
        
      if (stormData) setStorms(stormData)

      // 2. Fetch impacted properties count
      const { count: impacted } = await supabase
        .from('property_opportunity_scores')
        .select('*', { count: 'exact', head: true })
        .gte('opportunity_score', 10)
      
      setImpactedCount(impacted || 0)

      // 3. Current active reps in the field
      const { count: reps } = await supabase
        .from('route_sessions')
        .select('*', { count: 'exact', head: true })
        .is('ended_at', null)
        
      setActiveReps(reps || 0)

      // 4. Recent field outcomes today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { data: activityData } = await supabase
        .from('activities')
        .select('activity_type, outcome')
        .gte('occurred_at', today.toISOString())
        
      let knocks = 0
      let inspections = 0
      if (activityData) {
        for (const a of activityData) {
          if (a.activity_type === 'door_knock') knocks++
          if (a.outcome === 'inspect_now') inspections++
        }
      }
      setOutcomes({ doorsKnocked: knocks, inspectionsToday: inspections })
      
      setLoading(false)
    }
    
    loadData()
  }, [])

  if (loading) {
    return <div className="p-4 text-text-secondary text-sm">Loading Storm OS...</div>
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-text-secondary">Active Storms</div>
          <div className="mt-1 text-2xl font-bold text-text-primary">{storms.length}</div>
          <div className="text-xs text-text-secondary">60+ MPH wind events</div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-text-secondary">Impacted Properties</div>
          <div className="mt-1 text-2xl font-bold text-text-primary">{impactedCount}</div>
          <div className="text-xs text-text-secondary">Scored opportunities</div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-text-secondary">Active Reps</div>
          <div className="mt-1 text-2xl font-bold text-text-primary">{activeReps}</div>
          <div className="text-xs text-text-secondary">In the field</div>
        </Card>
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-text-secondary">Today's Outcomes</div>
          <div className="mt-1 text-2xl font-bold text-text-primary">{outcomes.doorsKnocked}</div>
          <div className="text-xs text-text-secondary">{outcomes.inspectionsToday} inspections requested</div>
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-bold text-text-primary">Recent Severe Events</h3>
        {storms.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">No severe storm events found.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {storms.map((s: any, i) => (
              <li key={i} className="flex justify-between items-center border-b border-border-subtle pb-2 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Wind: {s.wind_speed_mph} MPH {s.hail_size_inches ? `| Hail: ${s.hail_size_inches}"` : ''}</div>
                  <div className="text-xs text-text-secondary">Recorded {new Date(s.event_date).toLocaleDateString()}</div>
                </div>
                <div className="text-xs bg-bg-elevated px-2 py-1 rounded">
                  View Map
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

