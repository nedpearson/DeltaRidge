import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import { listInspections, localStorageFootprint, type LocalInspection } from '@/lib/db'
import { backendStatus } from '@/lib/backend'
import AccountPanel from '@/features/auth/AccountPanel'
import SyncPanel from '@/features/auth/SyncPanel'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { useSession } from '@/features/auth/session'
import { useRepToday } from '@/features/dashboard/useRepToday'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function inspectionTitle(i: LocalInspection): string {
  if (i.addressLine1) return i.addressLine1
  const name = [i.customerFirstName, i.customerLastName].filter(Boolean).join(' ')
  return name || i.customerCompanyName || 'Untitled inspection'
}

export default function HomePage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const [, setInspections] = useState<LocalInspection[]>([])
  const [footprint, setFootprint] = useState(0)
  const [, setRun] = useState<LeadRun | null>(null)
  const backend = backendStatus()
  
  const { data: today, loading } = useRepToday()

  useEffect(() => {
    void listInspections().then(setInspections)
    void localStorageFootprint().then(setFootprint)
    void readCachedRun().then(setRun)
  }, [])

  const rawEmail = session?.user?.email?.split('@')[0] || 'Rep'
  const repName = rawEmail.charAt(0).toUpperCase() + rawEmail.slice(1)

  return (
    <div className="space-y-6 pb-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold font-display tracking-tight">Good Morning, {repName}</h1>
        <p className="text-sm text-text-secondary mt-1">Here is your cockpit for today.</p>
      </div>

      <div>
        <SectionTitle>YOUR DAY</SectionTitle>
        <div className="mt-2 space-y-2">
          {loading ? (
            <Card className="bg-bg-card p-4 text-center text-text-secondary text-sm">Loading your day...</Card>
          ) : (
            <Card className="bg-bg-card p-3 shadow-sm ring-1 ring-border-subtle">
              <div className="flex justify-between items-center mb-2 pb-2 border-b border-border-subtle">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Next Appointment</span>
                <span className="text-[14px] font-bold text-text-primary">
                  {today?.nextAppointment ? `${today.nextAppointment.time} - ${today.nextAppointment.address}` : 'No appointments'}
                </span>
              </div>
              <div className="flex justify-between items-center mb-2 pb-2 border-b border-border-subtle">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Follow-ups Due</span>
                <span className={`text-[14px] font-bold ${today?.followUpsDue ? 'text-status-error' : 'text-text-primary'}`}>
                  {today?.followUpsDue || 0} due
                </span>
              </div>
              <div className="flex justify-between items-center mb-2 pb-2 border-b border-border-subtle">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Active Campaign</span>
                <span className="text-[14px] font-bold text-brand-500">{today?.activeCampaign || 'None'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Recommended Doors</span>
                <span className="text-[14px] font-bold text-status-success">{today?.recommendedDoors || 0} available</span>
              </div>
            </Card>
          )}
        </div>
      </div>

      <div>
        <SectionTitle>NEXT BEST ACTION</SectionTitle>
        {loading ? (
          <Card className="mt-2 p-4 text-center text-text-secondary text-sm">Finding best action...</Card>
        ) : today?.nextBestAction ? (
          <Card className="mt-2 border-l-4 border-l-brand-500 bg-brand-500/5">
            <div className="flex flex-col gap-3">
              <div>
                <h3 className="font-bold text-[16px] text-text-primary">{today.nextBestAction.address}</h3>
                <p className="text-[13px] text-text-secondary font-medium mt-1">Recommended target</p>
              </div>
              
              <div className="grid grid-cols-2 gap-2 text-[12.5px]">
                <div className="bg-bg-app/50 p-2 rounded">
                  <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Score</span>
                  <span className="font-bold text-status-success">Opportunity {today.nextBestAction.score}</span>
                </div>
                {today.nextBestAction.roofAge && (
                  <div className="bg-bg-app/50 p-2 rounded">
                    <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Age</span>
                    <span className="font-medium text-text-primary">{today.nextBestAction.roofAge}</span>
                  </div>
                )}
                {today.nextBestAction.stormEvidence && (
                  <div className="bg-bg-app/50 p-2 rounded">
                    <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Storm</span>
                    <span className="font-bold text-status-warning">{today.nextBestAction.stormEvidence}</span>
                  </div>
                )}
              </div>

              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="flex-1 text-[12px]" onClick={() => navigate('/map')}>Navigate</Button>
                <Button variant="secondary" className="flex-1 text-[12px]" onClick={() => navigate(`/property/${today.nextBestAction?.id}`)}>Open Lead</Button>
              </div>
            </div>
          </Card>
        ) : (
          <Card className="mt-2 p-4 text-center text-text-secondary text-sm border border-border-subtle">
            You have no open high-scoring leads in your territory.
          </Card>
        )}
      </div>

      {!backend.configured && (
        <Card className="mt-4 bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
          <p className="text-[12px] leading-relaxed text-status-warning/90">{backend.reason}</p>
        </Card>
      )}

      {/* Account and Sync panels moved to bottom as per recommendation */}
      <div className="grid gap-4 mt-8 opacity-75">
        <AccountPanel />
        <SyncPanel />
      </div>

      {footprint > 0 && (
        <p className="mt-6 text-center text-[11px] text-text-secondary">
          {formatBytes(footprint)} of photos stored on this device
        </p>
      )}
    </div>
  )
}
