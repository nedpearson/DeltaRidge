import { useEffect, useState } from 'react'
import { Card, Empty } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

export interface CalendarEvent {
  id: string
  title: string
  date: Date
  repId: string | null
  type: 'appointment' | 'inspection' | 'handoff'
}

interface CalendarTabProps {
  nameOf: (id: string | null) => string
  orgId: string | null
}

export default function CalendarTab({ nameOf, orgId }: CalendarTabProps) {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function load() {
      if (!orgId) {
        if (active) setLoading(false)
        return
      }

      const supabase = getSupabase()
      if (!supabase) {
        if (active) {
          setError('No server configured.')
          setLoading(false)
        }
        return
      }

      setLoading(true)

      const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

      const [actRes, handoffsRes] = await Promise.all([
        supabase
          .from('manager_activity_rows')
          .select('*')
          .eq('organization_id', orgId)
          .in('activity_type', ['appointment', 'inspection', 'appointment_set'])
          .gte('occurred_at', since)
          .limit(1000),
        supabase
          .from('office_handoffs')
          .select('*')
          .eq('organization_id', orgId)
          .limit(500)
      ])

      if (!active) return

      if (actRes.error) {
        setError(actRes.error.message)
        setLoading(false)
        return
      }

      const fetchedEvents: CalendarEvent[] = []

      for (const row of (actRes.data || [])) {
        fetchedEvents.push({
          id: 'act-' + row.id,
          title: (row.activity_type === 'inspection' ? 'Inspection' : 'Appointment') + ' at ' + (row.address_line1 || 'a door'),
          date: new Date(row.occurred_at),
          repId: row.user_id,
          type: row.activity_type === 'inspection' ? 'inspection' : 'appointment',
        })
      }

      for (const row of (handoffsRes.data || [])) {
        fetchedEvents.push({
          id: 'handoff-' + row.id,
          title: 'Handoff: ' + row.lead_client_id,
          date: new Date(row.created_at || Date.now()),
          repId: row.rep_id || row.assigned_to || null,
          type: 'handoff',
        })
      }

      fetchedEvents.sort((a, b) => b.date.getTime() - a.date.getTime())
      
      setEvents(fetchedEvents)
      setLoading(false)
    }

    void load()

    return () => {
      active = false
    }
  }, [orgId])

  if (loading) {
    return <Card><p className="text-[13px] text-text-secondary">Loading calendar...</p></Card>
  }

  if (error) {
    return (
      <Card className="bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
        <p className="text-[13.5px] font-semibold text-status-warning">Could not load calendar.</p>
        <p className="mt-1 text-[12px] leading-relaxed text-status-warning/70">{error}</p>
      </Card>
    )
  }

  if (events.length === 0) {
    return <Empty title="No upcoming activities" body="No appointments, inspections, or handoffs found for the team." />
  }

  const groupedByRep: Record<string, CalendarEvent[]> = {}
  for (const ev of events) {
    const key = ev.repId || 'unattributed'
    if (!groupedByRep[key]) groupedByRep[key] = []
    groupedByRep[key].push(ev)
  }

  return (
    <div className="space-y-4">
      {Object.entries(groupedByRep).map(([repId, repEvents]) => {
        const repName = repId === 'unattributed' ? 'Unassigned / Unattributed' : nameOf(repId)
        
        const appointmentsCount = repEvents.filter(e => e.type === 'appointment').length
        const inspectionCount = repEvents.filter(e => e.type === 'inspection').length
        const handoffCount = repEvents.filter(e => e.type === 'handoff').length

        const summaries = []
        if (appointmentsCount > 0) summaries.push(appointmentsCount + (appointmentsCount > 1 ? ' appointments' : ' appointment'))
        if (inspectionCount > 0) summaries.push(inspectionCount + (inspectionCount > 1 ? ' inspections' : ' inspection'))
        if (handoffCount > 0) summaries.push(handoffCount + (handoffCount > 1 ? ' handoffs' : ' handoff'))

        return (
          <Card key={repId}>
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[14px] font-semibold">{repName}</h3>
              <p className="text-[11.5px] text-text-secondary">{summaries.join(', ')}</p>
            </div>
            
            <div className="space-y-2">
              {repEvents.slice(0, 10).map((ev) => (
                <div key={ev.id} className="flex gap-3 items-center border-l-2 pl-3 py-1 border-border-subtle hover:border-brand-gold transition-colors">
                  <div className="w-16 shrink-0">
                    <p className="text-[12px] font-medium leading-tight">
                      {ev.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                    <p className="text-[10px] text-text-secondary uppercase">
                      {ev.date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{ev.title}</p>
                    <p className="text-[11px] text-text-secondary uppercase tracking-wider mt-0.5">{ev.type}</p>
                  </div>
                </div>
              ))}
              {repEvents.length > 10 && (
                <p className="text-[11px] text-text-secondary mt-2 pl-3">
                  + {repEvents.length - 10} more older activities
                </p>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}

