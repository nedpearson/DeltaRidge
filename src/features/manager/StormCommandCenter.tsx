/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

export function StormCommandCenter() {
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  
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
      
      const [
        { count: activeStorms },
        { count: newLeads },
        { count: unassigned },
        { count: activeReps },
        { count: appointments },
        { count: inspections },
        { count: estimates },
        { count: wins },
        { count: aiExceptions }
      ] = await Promise.all([
        supabase.from('storm_events').select('*', { count: 'exact', head: true }).gte('wind_speed_mph', 60),
        supabase.from('leads').select('*', { count: 'exact', head: true }).in('status', ['untouched', 'target']),
        supabase.from('leads').select('*', { count: 'exact', head: true }).is('assigned_to', null),
        supabase.from('route_sessions').select('*', { count: 'exact', head: true }).is('ended_at', null),
        supabase.from('appointments').select('*', { count: 'exact', head: true }),
        supabase.from('inspections').select('*', { count: 'exact', head: true }),
        supabase.from('estimates').select('*', { count: 'exact', head: true }),
        supabase.from('leads').select('*', { count: 'exact', head: true }).eq('status', 'sold'),
        supabase.from('ai_agent_runs').select('*', { count: 'exact', head: true }).eq('approval_status', 'pending')
      ])

      // Calculate pipeline (estimate totals)
      const { data: pipelineData } = await supabase
        .from('estimate_versions')
        .select('total_price_cents')
      
      const totalPipelineCents = pipelineData?.reduce((acc, curr) => acc + (curr.total_price_cents || 0), 0) || 0

      setKpis({
        activeStorms: activeStorms || 0,
        newLeads: newLeads || 0,
        unassigned: unassigned || 0,
        activeReps: activeReps || 0,
        routes: activeReps || 0, // Using active reps for routes count
        appointments: appointments || 0,
        followUps: 0,
        inspections: inspections || 0,
        estimates: estimates || 0,
        wins: wins || 0,
        pipeline: totalPipelineCents,
        aiExceptions: aiExceptions || 0,
        integrationAlerts: 0
      });

      setLoading(false)
    }
    
    loadData()
  }, [])

  if (loading) {
    return <div className="p-4 text-text-secondary text-sm">Loading Storm OS...</div>
  }

  const KpiCard = ({ label, value, subtitle, highlight = false, alert = false, onClick }: any) => (
    <div onClick={onClick} className="cursor-pointer group">
      <Card className={`relative overflow-hidden transition-colors group-hover:bg-bg-elevated ${alert ? 'border-status-error border-2' : ''}`}>
        {highlight && <div className="absolute top-0 left-0 w-full h-1 bg-brand-primary"></div>}
        {alert && <div className="absolute top-0 left-0 w-full h-1 bg-status-error"></div>}
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-secondary group-hover:text-text-primary transition-colors">{label}</div>
        <div className={`mt-2 text-3xl font-bold ${alert ? 'text-status-error' : 'text-text-primary'}`}>{value}</div>
        {subtitle && <div className="mt-1 text-xs text-text-secondary">{subtitle}</div>}
      </Card>
    </div>
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
                 <button onClick={() => navigate('/leads')} className="mt-2 text-xs bg-brand-primary text-white px-2 py-1 rounded hover:bg-brand-secondary transition-colors">Assign Now</button>
               </div>
             )}
             {kpis.aiExceptions > 0 && (
               <div className="bg-bg-app border border-border-subtle p-3 rounded">
                 <div className="text-xs font-bold text-text-primary">AI Exceptions ({kpis.aiExceptions})</div>
                 <div className="text-xs text-text-secondary mt-1">AI agent stalled on inbound queries</div>
                 <button onClick={() => navigate('/settings')} className="mt-2 text-xs bg-brand-primary text-white px-2 py-1 rounded hover:bg-brand-secondary transition-colors">Intervene</button>
               </div>
             )}
             {kpis.integrationAlerts > 0 && (
               <div className="bg-bg-app border border-border-subtle p-3 rounded">
                 <div className="text-xs font-bold text-text-primary">Integration Alerts ({kpis.integrationAlerts})</div>
                 <div className="text-xs text-text-secondary mt-1">CRM sync failed for recent wins</div>
                 <button onClick={() => navigate('/settings')} className="mt-2 text-xs bg-brand-primary text-white px-2 py-1 rounded hover:bg-brand-secondary transition-colors">Review Sync</button>
               </div>
             )}
           </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-bold text-text-primary uppercase tracking-wide mb-3">Actionable KPIs</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <KpiCard label="ACTIVE STORMS" value={kpis.activeStorms} highlight onClick={() => navigate('/storm-os')} />
          <KpiCard label="NEW LEADS" value={kpis.newLeads} onClick={() => navigate('/leads')} />
          <KpiCard label="UNASSIGNED" value={kpis.unassigned} alert={kpis.unassigned > 0} onClick={() => navigate('/leads')} />
          <KpiCard label="ACTIVE REPS" value={kpis.activeReps} onClick={() => navigate('/team')} />
          <KpiCard label="ROUTES" value={kpis.routes} onClick={() => navigate('/team')} />
          <KpiCard label="APPOINTMENTS" value={kpis.appointments} onClick={() => navigate('/leads')} />
          <KpiCard label="FOLLOW-UPS" value={kpis.followUps} onClick={() => navigate('/leads')} />
          <KpiCard label="INSPECTIONS" value={kpis.inspections} onClick={() => navigate('/leads')} />
          <KpiCard label="ESTIMATES" value={kpis.estimates} onClick={() => navigate('/leads')} />
          <KpiCard label="WINS" value={kpis.wins} highlight onClick={() => navigate('/leads')} />
          <KpiCard label="PIPELINE" value={'$' + (kpis.pipeline / 100000).toFixed(1) + 'k'} onClick={() => navigate('/leads')} />
        </div>
      </div>
    </div>
  )
}
