import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-bg-card p-3 shadow-sm ring-1 ring-border-subtle flex flex-col items-center justify-center">
      <div className="text-xl font-bold text-brand-500">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mt-1">{label}</div>
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const { session } = useSession()
  const [inspections, setInspections] = useState<LocalInspection[]>([])
  const [footprint, setFootprint] = useState(0)
  const [, setRun] = useState<LeadRun | null>(null)
  const backend = backendStatus()

  useEffect(() => {
    void listInspections().then(setInspections)
    void localStorageFootprint().then(setFootprint)
    void readCachedRun().then(setRun)
  }, [])

  const open = inspections.filter((i) => i.status === 'in_progress')
  
  const rawEmail = session?.user?.email?.split('@')[0] || 'Rep'
  const repName = rawEmail.charAt(0).toUpperCase() + rawEmail.slice(1)

  return (
    <div className="space-y-6 pb-6">
      <div className="mb-2">
        <h1 className="text-2xl font-bold font-display tracking-tight">Good Morning, {repName}</h1>
        <p className="text-sm text-text-secondary mt-1">Here is your cockpit for today.</p>
      </div>

      <div>
        <SectionTitle>TODAY'S PROGRESS</SectionTitle>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-2">
          <StatCard label="Assigned" value="24" />
          <StatCard label="Knocked" value="12" />
          <StatCard label="Spoke" value="5" />
          <StatCard label="Inspects" value="2" />
          <StatCard label="Appts" value="1" />
          <StatCard label="Props" value="0" />
        </div>
      </div>

      <div>
        <SectionTitle>NEXT BEST ACTION</SectionTitle>
        <Card className="mt-2 border-l-4 border-l-brand-500 bg-brand-500/5">
          <div className="flex flex-col gap-2">
            <div>
              <h3 className="font-bold text-[15px] text-text-primary">123 Oak Ridge Dr</h3>
              <p className="text-[13px] text-text-secondary">0.4 mi away · Opportunity 87</p>
            </div>
            <div className="text-[13px] text-text-primary bg-bg-app/50 p-2 rounded-lg">
              <strong className="text-brand-600">Why Now?</strong> Roof ~16 yrs, 1.5 inch hail evidence in area. High propensity to buy based on recent nearby closures.
            </div>
            <div className="mt-2 flex gap-3">
              <Button variant="primary" className="flex-1" onClick={() => navigate('/map')}>Navigate</Button>
              <Button variant="secondary" className="flex-1" onClick={() => navigate('/leads')}>Open Lead</Button>
            </div>
          </div>
        </Card>
      </div>

      <div>
        <SectionTitle>TASK LISTS</SectionTitle>
        <div className="space-y-2 mt-2">
          <Card className="flex justify-between items-center bg-bg-card">
            <div>
              <h4 className="font-semibold text-[14px] text-status-success">Active Route</h4>
              <p className="text-[12px] text-text-secondary mt-0.5">Oak Ridge Subdivision · Started 45m ago</p>
            </div>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigate('/map')}>Resume</Button>
          </Card>
          <Card className="flex justify-between items-center bg-bg-card border-l-2 border-status-error">
            <div>
              <h4 className="font-semibold text-[14px] text-status-error">Overdue Follow-up</h4>
              <p className="text-[12px] text-text-secondary mt-0.5">456 Elm St · Proposal Sent 3 days ago</p>
            </div>
            <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigate('/leads')}>Review</Button>
          </Card>
          {open.length > 0 && open[0] !== undefined && (
            <Card className="flex justify-between items-center bg-bg-card border-l-2 border-status-warning">
              <div>
                <h4 className="font-semibold text-[14px] text-status-warning">Finish Inspection</h4>
                <p className="text-[12px] text-text-secondary mt-0.5">{inspectionTitle(open[0])} · Needs 2 more photos</p>
              </div>
              <Button variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => navigate(`/inspection/${open[0]!.id}`)}>Complete</Button>
            </Card>
          )}
        </div>
      </div>

      {!backend.configured && (
        <Card className="mt-4 bg-warning-surface ring-1 ring-warning-border border-l-4 border-l-warning-base">
          <p className="text-[12px] leading-relaxed text-status-warning/90">{backend.reason}</p>
        </Card>
      )}

      <div className="grid gap-4">
        <AccountPanel />
        <SyncPanel />
        <Link to="/manager" className="block">
          <Card className="hover:bg-bg-elevated transition-colors">
            <p className="text-[13.5px] font-semibold">Team</p>
            <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
              Who knocked what, who is out on a route, how doors were handed out and why.
            </p>
          </Card>
        </Link>
      </div>

      {footprint > 0 && (
        <p className="mt-6 text-center text-[11px] text-text-secondary">
          {formatBytes(footprint)} of photos stored on this device
        </p>
      )}
    </div>
  )
}
