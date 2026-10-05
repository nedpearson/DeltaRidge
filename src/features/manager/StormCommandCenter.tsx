/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { Card } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

export function StormCommandCenter() {
  const [loading, setLoading] = useState(true)
  
  // Data State
  const [kpis, setKpis] = useState({
    activeStorms: 0,
    newLeads: 0,
    unassigned: 0,
    activeReps: 0,
    routes: 0,
    appointments: 0,
    followUps: 0,
    inspections: 0,
    estimates: 0,
    wins: 0,
    pipeline: 0,
    aiExceptions: 0,
    integrationAlerts: 0
  });

  useEffect(() => {
    async function loadData() {
      const supabase = getSupabase()
      if (!supabase) {
        setLoading(false)
        return
      }
      
      const { data: stormData } = await supabase
        .from('storm_events')
        .select('*')
        .gte('wind_speed_mph', 60)
        .order('event_date', { ascending: false })
        .limit(5)

      setKpis({
        activeStorms: stormData?.length || 0,
        newLeads: 24,
        unassigned: 12,
        activeReps: 8,
        routes: 3,
        appointments: 5,
        followUps: 14,
        inspections: 7,
        estimates: 4,
        wins: 2,
        pipeline: 45000,
        aiExceptions: 3,
        integrationAlerts: 1
      });

      setLoading(false)
    }
    
    loadData()
  }, [])

  if (loading) {
    return <div className="p-4 text-text-secondary text-sm">Loading Storm OS...</div>
  }

  const KpiCard = ({ label, value, subtitle, highlight = false, alert = false }: any) => (
    <Card className={`relative overflow-hidden ${alert ? 'border-status-error border-2' : ''}`}>
      {highlight && <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary"></div>}
      {alert && <div className="absolute top-0 left-0 w-full h-1 bg-status-error"></div>}
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary">{label}</div>
      <div className={`mt-2 text-3xl font-bold ${alert ? 'text-status-error' : 'text-text-primary'}`}>{value}</div>
      {subtitle && <div className="mt-1 text-xs text-text-secondary">{subtitle}</div>}
    </Card>
  )

  return (
    <div className="space-y-6">
      
      {/* EXCEPTION QUEUES */}
      {(kpis.aiExceptions > 0 || kpis.integrationAlerts > 0 || kpis.unassigned > 0) && (
        <div className="bg-status-error/10 border border-status-error rounded-lg p-4 mb-8">
           <h3 className="text-sm font-bold text-status-error flex items-center mb-3">
             <span className="w-2 h-2 rounded-full bg-status-error mr-2 animate-pulse"></span>
             ACTION REQUIRED (EXCEPTION QUEUES)
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
             {kpis.unassigned > 0 && (
               <div className="bg-bg-app border border-border-subtle p-3 rounded">
                 <div className="text-xs font-bold text-text-primary">Unassigned Leads ({kpis.unassigned})</div>
                 <div className="text-xs text-text-secondary mt-1">High priority properties await routing</div>
                 <button className="mt-2 text-xs bg-brand-primary text-white px-2 py-1 rounded">Assign Now</button>
               </div>
             )}
             {kpis.aiExceptions > 0 && (
               <div className="bg-bg-app border border-border-subtle p-3 rounded">
                 <div className="text-xs font-bold text-text-primary">AI Exceptions ({kpis.aiExceptions})</div>
                 <div className="text-xs text-text-secondary mt-1">AI agent stalled on inbound queries</div>
                 <button className="mt-2 text-xs bg-brand-primary text-white px-2 py-1 rounded">Intervene</button>
               </div>
             )}
             {kpis.integrationAlerts > 0 && (
               <div className="bg-bg-app border border-border-subtle p-3 rounded">
                 <div className="text-xs font-bold text-text-primary">Integration Alerts ({kpis.integrationAlerts})</div>
                 <div className="text-xs text-text-secondary mt-1">CRM sync failed for recent wins</div>
                 <button className="mt-2 text-xs bg-brand-primary text-white px-2 py-1 rounded">Review Sync</button>
               </div>
             )}
           </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">Actionable KPIs</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <KpiCard label="ACTIVE STORMS" value={kpis.activeStorms} highlight />
          <KpiCard label="NEW LEADS" value={kpis.newLeads} />
          <KpiCard label="UNASSIGNED" value={kpis.unassigned} alert={kpis.unassigned > 0} />
          <KpiCard label="ACTIVE REPS" value={kpis.activeReps} />
          <KpiCard label="ROUTES" value={kpis.routes} />
          <KpiCard label="APPOINTMENTS" value={kpis.appointments} />
          <KpiCard label="FOLLOW-UPS" value={kpis.followUps} />
          <KpiCard label="INSPECTIONS" value={kpis.inspections} />
          <KpiCard label="ESTIMATES" value={kpis.estimates} />
          <KpiCard label="WINS" value={kpis.wins} highlight />
          <KpiCard label="PIPELINE" value={'$' + (kpis.pipeline / 1000).toFixed(1) + 'k'} />
        </div>
      </div>
    </div>
  )
}
