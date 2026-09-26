import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, SectionTitle } from '@/components/ui'
import { listInspections, localStorageFootprint, type LocalInspection } from '@/lib/db'
import { backendStatus } from '@/lib/backend'
import AccountPanel from '@/features/auth/AccountPanel'
import SyncPanel from '@/features/auth/SyncPanel'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'
import { useSession } from '@/features/auth/session'

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
          <Card className="bg-bg-card p-3 shadow-sm ring-1 ring-border-subtle">
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-border-subtle">
              <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Next Appointment</span>
              <span className="text-[14px] font-bold text-text-primary">8:30 AM</span>
            </div>
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-border-subtle">
              <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Follow-ups Due</span>
              <span className="text-[14px] font-bold text-status-error">3 due</span>
            </div>
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-border-subtle">
              <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Active Campaign</span>
              <span className="text-[14px] font-bold text-brand-500">Oak Hills</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-[13px] text-text-secondary font-medium uppercase tracking-wide">Recommended Doors</span>
              <span className="text-[14px] font-bold text-status-success">18 remaining</span>
            </div>
          </Card>
        </div>
      </div>

      <div>
        <SectionTitle>NEXT BEST ACTION</SectionTitle>
        <Card className="mt-2 border-l-4 border-l-brand-500 bg-brand-500/5">
          <div className="flex flex-col gap-3">
            <div>
              <h3 className="font-bold text-[16px] text-text-primary">4431 Ridgeway Dr</h3>
              <p className="text-[13px] text-text-secondary font-medium mt-1">0.3 miles away</p>
            </div>
            
            <div className="grid grid-cols-2 gap-2 text-[12.5px]">
              <div className="bg-bg-app/50 p-2 rounded">
                <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Score</span>
                <span className="font-bold text-status-success">Opportunity 91</span>
              </div>
              <div className="bg-bg-app/50 p-2 rounded">
                <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Property</span>
                <span className="font-medium text-text-primary">Owner occupied</span>
              </div>
              <div className="bg-bg-app/50 p-2 rounded">
                <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Age</span>
                <span className="font-medium text-text-primary">Roof ~17 years</span>
              </div>
              <div className="bg-bg-app/50 p-2 rounded">
                <span className="block text-text-secondary text-[10px] uppercase tracking-wider mb-0.5">Storm</span>
                <span className="font-bold text-status-warning">1.75" hail evidence</span>
              </div>
            </div>

            <div className="mt-2 flex gap-2">
              <Button variant="primary" className="flex-1 text-[12px]" onClick={() => navigate('/map')}>Navigate</Button>
              <Button variant="secondary" className="flex-1 text-[12px]" onClick={() => navigate('/leads')}>Why This House</Button>
              <Button variant="secondary" className="flex-1 text-[12px]">Knocked It</Button>
            </div>
          </div>
        </Card>
      </div>

      {!backend.configured && (
        <Card className="mt-4 bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
          <p className="text-[12px] leading-relaxed text-status-warning/90">{backend.reason}</p>
        </Card>
      )}

      <div className="grid gap-4">
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
