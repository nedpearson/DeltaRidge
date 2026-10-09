import { useNavigate } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import type { LocalInspection } from '@/lib/db'

export function inspectionTitle(i: LocalInspection): string {
  if (i.addressLine1) return i.addressLine1
  const name = [i.customerFirstName, i.customerLastName].filter(Boolean).join(' ')
  return name || i.customerCompanyName || 'Untitled inspection'
}

import { useSession } from '@/features/auth/session'
import { useRepToday } from '@/features/dashboard/useRepToday'
import { CalendarClock, Target, ChevronRight, Activity, Users, AlertTriangle, ShieldCheck, Flame } from 'lucide-react'

function ManagerDashboard() {
  const navigate = useNavigate()
  
  return (
    <div className="space-y-5 pb-20">
      <div>
        <h1 className="text-[clamp(1.35rem,6vw,1.75rem)] font-bold font-display tracking-tight text-text-primary">Manager Overview</h1>
      </div>
      <div>
        <SectionTitle>ACTIVE STORMS</SectionTitle>
        <div className="mt-2 p-4 flex items-center justify-between rounded-xl ring-1 ring-border-subtle shadow-sm bg-bg-card cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => navigate('/storm-os')}>
          <div className="flex items-center gap-3">
            <Activity className="text-brand-500 w-5 h-5" />
            <div>
              <div className="font-bold text-text-primary text-sm">Recent Hail Activity</div>
              <div className="text-xs text-text-secondary">3 active tracks in region</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </div>
      </div>

      <div>
        <SectionTitle>UNASSIGNED PRIORITY LEADS</SectionTitle>
        <Card className="mt-2 p-4 text-center text-text-secondary text-sm border border-border-subtle">
          0 high-priority leads need assignment.
        </Card>
      </div>

      <div>
        <SectionTitle>ACTIVE REPS</SectionTitle>
        <div className="mt-2 p-4 flex items-center justify-between rounded-xl ring-1 ring-border-subtle shadow-sm bg-bg-card cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => navigate('/team')}>
          <div className="flex items-center gap-3">
            <Users className="text-brand-500 w-5 h-5" />
            <div>
              <div className="font-bold text-text-primary text-sm">Field Activity</div>
              <div className="text-xs text-text-secondary">4 reps currently active</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </div>
      </div>

      <div>
        <SectionTitle>BLOCKERS / EXCEPTIONS</SectionTitle>
        <div className="mt-2 p-4 flex items-center justify-between rounded-xl ring-1 ring-status-error/30 shadow-sm bg-status-error/10 cursor-pointer hover:bg-status-error/20 transition-colors" onClick={() => navigate('/exceptions')}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-status-error w-5 h-5" />
            <div>
              <div className="font-bold text-text-primary text-sm">Action Required</div>
              <div className="text-xs text-text-secondary">2 blocked inspections</div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-text-muted" />
        </div>
      </div>
    </div>
  )
}

function RepDashboard() {
  const navigate = useNavigate()
  const { data: today, loading } = useRepToday()

  const nextTarget = today?.nextAppointment 
    ? { type: 'appointment', label: 'PRE-BOOKED APPOINTMENT', title: today.nextAppointment.time, subtitle: today.nextAppointment.address, id: today.nextAppointment.leadId } 
    : today?.nextBestAction 
      ? { type: 'lead', label: 'AI-VERIFIED HOT LEAD', title: today.nextBestAction.address, subtitle: today.nextBestAction.reason || 'Damage Verified \u2022 12+ Yr Roof', id: today.nextBestAction.id }
      : null;

  return (
    <div className="space-y-5 pb-20">
      <div>
        <h1 className="text-[clamp(1.35rem,6vw,1.75rem)] font-bold font-display tracking-tight text-text-primary">Today's Schedule</h1>
        <p className="text-sm text-text-secondary mt-1">Don't knock randomly. Follow your AI-verified leads.</p>
      </div>

      <div>
        <SectionTitle>NEXT TARGET</SectionTitle>
        {loading ? (
          <Card className="mt-2 p-4 text-center text-text-secondary text-sm">Loading...</Card>
        ) : nextTarget ? (
          <Card className="mt-2 border-l-4 border-l-brand-500 bg-brand-500/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              {nextTarget.type === 'appointment' ? <CalendarClock size={48} /> : <Target size={48} />}
            </div>
            <div className="flex flex-col gap-3 relative z-10">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-4 h-4 text-brand-500" />
                <span className="text-[10px] uppercase tracking-wider text-brand-500 font-bold">{nextTarget.label}</span>
              </div>
              <div>
                <h3 className="font-bold text-[18px] text-text-primary leading-tight">{nextTarget.title}</h3>
                <p className="text-[13px] text-text-secondary font-medium mt-0.5">{nextTarget.subtitle}</p>
              </div>
              
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="primary" className="flex-1 text-[13px] py-2.5 font-bold" onClick={() => navigate('/mission')}>DRIVE</Button>
                {nextTarget.id && (
                  <Button variant="secondary" className="flex-1 text-[13px] py-2.5 font-bold bg-white" onClick={() => navigate('/lead/' + nextTarget.id)}>VIEW INTELLIGENCE</Button>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card className="mt-2 p-4 text-center text-text-secondary text-sm border border-border-subtle">
            You have no upcoming appointments.
          </Card>
        )}
      </div>

      <div>
        <SectionTitle>AUTONOMOUS LEADS QUEUE</SectionTitle>
        <Card className="mt-2 bg-bg-card p-0 shadow-sm ring-1 ring-border-subtle divide-y divide-border-subtle overflow-hidden">
          <div className="flex justify-between items-center p-3">
            <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide flex items-center gap-2"><Flame className="w-4 h-4 text-orange-500" /> Pre-Qualified Pipeline</span>
            <Button variant="primary" className="py-1 px-3 text-xs" onClick={() => navigate('/mission')}>Start Route</Button>
          </div>
          <div className="flex justify-between items-center p-3 cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => navigate('/leads')}>
            <div>
              <div className="text-[13px] text-text-primary font-bold tracking-wide">AI-Verified Hot Leads</div>
              <div className="text-[11px] text-text-secondary">Storm hit + 12+ yr roof + Property matched</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-text-primary">{today?.nearbyOpportunities?.length || 0}</span>
              <ChevronRight className="w-4 h-4 text-text-muted" />
            </div>
          </div>
        </Card>
      </div>

      <div>
        <SectionTitle>OPEN INSPECTIONS</SectionTitle>
        <div className="mt-2 p-4 text-center text-text-secondary text-sm rounded-xl ring-1 ring-border-subtle shadow-sm bg-bg-card cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => navigate('/inspections')}>
          View your assigned jobs and active inspections.
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const { membership } = useSession()
  const role = membership?.role?.toLowerCase() || 'rep'
  const isManager = role === 'admin' || role === 'manager'

  return isManager ? <ManagerDashboard /> : <RepDashboard />
}
