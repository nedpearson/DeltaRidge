import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import { listInspections, type LocalInspection } from '@/lib/db'
import { backendStatus } from '@/lib/backend'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { useSession } from '@/features/auth/session'
import { useRepToday } from '@/features/dashboard/useRepToday'
import { AlertCircle, CalendarClock, ChevronRight, MapPin, Target } from 'lucide-react'

export function inspectionTitle(i: LocalInspection): string {
  if (i.addressLine1) return i.addressLine1
  const name = [i.customerFirstName, i.customerLastName].filter(Boolean).join(' ')
  return name || i.customerCompanyName || 'Untitled inspection'
}

export default function HomePage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const [, setInspections] = useState<LocalInspection[]>([])
  const [, setRun] = useState<LeadRun | null>(null)
  const backend = backendStatus()
  
  const { data: today, loading } = useRepToday()

  useEffect(() => {
    void listInspections().then(setInspections)
    void readCachedRun().then(setRun)
  }, [])

  const rawEmail = session?.user?.email?.split('@')[0] || 'Rep'
  const repName = rawEmail.charAt(0).toUpperCase() + rawEmail.slice(1)

  const nextTarget = today?.nextAppointment 
    ? { type: 'appointment', label: 'Upcoming Appointment', title: today.nextAppointment.time, subtitle: today.nextAppointment.address, id: today.nextAppointment.leadId } 
    : today?.nextBestAction 
      ? { type: 'lead', label: 'Highest Priority Opportunity', title: today.nextBestAction.address, subtitle: today.nextBestAction.reason || 'Recommended target', id: today.nextBestAction.id }
      : null;

  return (
    <div className="space-y-6 pb-20">
      <div className="mb-2">
        <h1 className="text-2xl font-bold font-display tracking-tight text-text-primary">Good Morning, {repName}</h1>
      </div>

      <div>
        <SectionTitle>NEXT</SectionTitle>
        {loading ? (
          <Card className="mt-2 p-4 text-center text-text-secondary text-sm">Loading priority...</Card>
        ) : nextTarget ? (
          <Card className="mt-2 border-l-4 border-l-brand-500 bg-brand-500/5 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              {nextTarget.type === 'appointment' ? <CalendarClock size={48} /> : <Target size={48} />}
            </div>
            <div className="flex flex-col gap-3 relative z-10">
              <div>
                <span className="text-[10px] uppercase tracking-wider text-brand-500 font-bold">{nextTarget.label}</span>
                <h3 className="font-bold text-[18px] text-text-primary leading-tight mt-1">{nextTarget.title}</h3>
                <p className="text-[13px] text-text-secondary font-medium mt-0.5">{nextTarget.subtitle}</p>
              </div>
              
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="flex-1 text-[13px] py-2.5 font-bold" onClick={() => navigate('/mission')}>GO</Button>
                {nextTarget.id && (
                  <Button variant="secondary" className="flex-1 text-[13px] py-2.5" onClick={() => navigate('/lead/' + nextTarget.id)}>OPEN</Button>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <Card className="mt-2 p-4 text-center text-text-secondary text-sm border border-border-subtle">
            You have no critical appointments or assigned leads.
          </Card>
        )}
      </div>

      <div>
        <SectionTitle>YOUR DAY</SectionTitle>
        <div className="mt-2">
          {loading ? (
            <Card className="bg-bg-card p-4 text-center text-text-secondary text-sm">Loading...</Card>
          ) : (
            <Card className="bg-bg-card p-0 shadow-sm ring-1 ring-border-subtle divide-y divide-border-subtle overflow-hidden">
              <div className="flex justify-between items-center p-3">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Appointments</span>
                <span className="text-[14px] font-bold text-text-primary">{today?.nextAppointment ? '1 scheduled' : '0 scheduled'}</span>
              </div>
              <div className="flex justify-between items-center p-3">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Route Progress</span>
                <span className="text-[14px] font-bold text-text-primary">{today?.recommendedDoors || 0} doors</span>
              </div>
              <div className="flex justify-between items-center p-3">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Follow-ups</span>
                <span className={	ext-[14px] font-bold }>
                  {today?.followUpsDue || 0} due
                </span>
              </div>
            </Card>
          )}
        </div>
      </div>

      {(today?.followUpsDue || !backend.configured) && (
        <div>
          <SectionTitle>ATTENTION</SectionTitle>
          <div className="mt-2 space-y-2">
            {!backend.configured && (
              <div className="rounded-xl bg-status-error/10 ring-1 ring-status-error/30 p-3 flex gap-3 items-start cursor-pointer hover:bg-status-error/20 transition-colors" onClick={() => navigate('/diagnostics')}>
                <AlertCircle className="w-5 h-5 text-status-error shrink-0" />
                <div>
                  <h4 className="text-[13px] font-bold text-text-primary">System Offline</h4>
                  <p className="text-[12px] text-text-secondary mt-0.5">{backend.reason}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted ml-auto my-auto" />
              </div>
            )}
            {today?.followUpsDue && today.followUpsDue > 0 && (
              <div className="rounded-xl bg-status-warning/10 ring-1 ring-status-warning/30 p-3 flex gap-3 items-start cursor-pointer hover:bg-status-warning/20 transition-colors" onClick={() => navigate('/leads')}>
                <AlertCircle className="w-5 h-5 text-status-warning shrink-0" />
                <div>
                  <h4 className="text-[13px] font-bold text-text-primary">{today.followUpsDue} Overdue Follow-ups</h4>
                  <p className="text-[12px] text-text-secondary mt-0.5">Contacts that require immediate attention.</p>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted ml-auto my-auto" />
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <SectionTitle>PACE LEADERBOARD</SectionTitle>
        <Card className="mt-2 p-4 border-l-4 border-l-gold-500 bg-gradient-to-br from-bg-card to-bg-elevated">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-gold-400">Your Daily Pace</p>
              <p className="text-[28px] font-display font-bold leading-none mt-1 text-text-primary">64<span className="text-[16px] text-text-secondary">/100</span></p>
              <p className="text-[11px] text-text-muted mt-1">Doors knocked today</p>
            </div>
            <div className="w-16 h-16 rounded-full border-4 border-bg-page flex items-center justify-center bg-gold-500/10 relative">
              <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" className="text-bg-page" />
                <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="4" fill="none" strokeDasharray="175" strokeDashoffset={175 - (175 * 0.64)} className="text-gold-500 transition-all duration-1000" />
              </svg>
              <span className="text-[13px] font-bold text-gold-400 z-10">64%</span>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-border-subtle">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-text-secondary">Current Rank: <strong className="text-text-primary">#3</strong></span>
              <span className="text-gold-400 text-[11px] font-bold uppercase">12 behind #1</span>
            </div>
          </div>
        </Card>
      </div>

      <div className="mt-6">
        <SectionTitle>NEARBY OPPORTUNITIES</SectionTitle>
        <Card className="mt-2 bg-bg-card p-0 shadow-sm ring-1 ring-border-subtle divide-y divide-border-subtle overflow-hidden">
          {loading ? (
             <div className="p-4 text-center text-sm text-text-secondary">Loading opportunities...</div>
          ) : today?.nearbyOpportunities && today.nearbyOpportunities.length > 0 ? (
            today.nearbyOpportunities.map(opp => (
              <div key={opp.id} className="flex gap-3 items-center p-3 cursor-pointer hover:bg-bg-elevated transition-colors" onClick={() => navigate('/lead/' + opp.id)}>
                <div className="bg-bg-elevated p-2 rounded-lg shrink-0">
                  <MapPin className="w-4 h-4 text-brand-cyan" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-[13px] font-bold text-text-primary truncate">{opp.address}</h4>
                  <p className="text-[11px] text-text-secondary truncate">{opp.reason}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
              </div>
            ))
          ) : (
            <div className="p-4 text-center text-sm text-text-secondary">
              No immediate opportunities assigned nearby.
            </div>
          )}
        </Card>
      </div>

    </div>
  )
}
