import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { listInspections, localStorageFootprint, type LocalInspection } from '@/lib/db'
import { backendStatus } from '@/lib/backend'
import AccountPanel from '@/features/auth/AccountPanel'
import SyncPanel from '@/features/auth/SyncPanel'
import { readCachedRun, type LeadRun } from '@/features/leads/engine'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function relative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function inspectionTitle(i: LocalInspection): string {
  if (i.addressLine1) return i.addressLine1
  const name = [i.customerFirstName, i.customerLastName].filter(Boolean).join(' ')
  return name || i.customerCompanyName || 'Untitled inspection'
}

export default function HomePage() {
  const navigate = useNavigate()
  const [inspections, setInspections] = useState<LocalInspection[]>([])
  const [footprint, setFootprint] = useState(0)
  const [run, setRun] = useState<LeadRun | null>(null)
  const backend = backendStatus()

  useEffect(() => {
    void listInspections().then(setInspections)
    void localStorageFootprint().then(setFootprint)
    // Cache only, never the network: Home has to open instantly in a truck with
    // one bar, and the door list is a tab away if the rep wants a fresh one.
    void readCachedRun().then(setRun)
  }, [])

  const open = inspections.filter((i) => i.status === 'in_progress')
  const done = inspections.filter((i) => i.status === 'complete')
  const topDoors = run?.leads.slice(0, 3) ?? []

  return (
    <div>
      {topDoors.length > 0 ? (
        <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 ring-1 ring-slate-200">
          <p className="font-display text-lg leading-tight tracking-wide">
            {run?.leads.length} door{run?.leads.length === 1 ? '' : 's'} worth knocking.
          </p>
          <p className="mt-1 text-[12px] text-[var(--color-ink)]/">
            Built {relative(run?.ranAt ?? new Date().toISOString())} · hail, roof age, nothing already re-roofed
          </p>

          <ul className="mt-3 space-y-2">
            {topDoors.map((lead) => (
              <li key={lead.addressKey} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[13.5px] font-semibold">{lead.address}</p>
                  <span className="shrink-0 font-display text-[15px] text-gold-400">{lead.score}</span>
                </div>
                <p className="mt-0.5 truncate text-[11.5px] text-[var(--color-ink)]/">{lead.reasons[0]}</p>
              </li>
            ))}
          </ul>

          <Button variant="gold" full className="mt-4" onClick={() => navigate('/leads')}>
            Open the door list
          </Button>
          <Button variant="secondary" full className="mt-2" onClick={() => navigate('/new')}>
            Start an inspection
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 ring-1 ring-slate-200">
          <p className="font-display text-lg leading-tight tracking-wide">
            Document the roof.
            <br />
            Leave with nothing missing.
          </p>
          <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-[var(--color-ink)]/">
            Guided capture, on-device quality checks, and a completeness review before you drive away.
          </p>
          <Button variant="gold" full className="mt-4" onClick={() => navigate('/new')}>
            Start an inspection
          </Button>
          <Button variant="secondary" full className="mt-2" onClick={() => navigate('/leads')}>
            Build today's door list
          </Button>
        </div>
      )}

      {!backend.configured && (
        <Card className="mt-4 !bg-amber-500/8 ring-amber-500/20">
          <p className="text-[12px] leading-relaxed text-amber-200/90">{backend.reason}</p>
        </Card>
      )}

      <AccountPanel />

      <SyncPanel />

      {/* Shown to everyone. What each person can actually see is decided by row
          level security on the server, not by whether this link is rendered. */}
      <Link to="/manager" className="block">
        <Card>
          <p className="text-[13.5px] font-semibold">Team</p>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-ink)]/">
            Who knocked what, who is out on a route, how doors were handed out and why.
          </p>
        </Card>
      </Link>

      {open.length > 0 && (
        <>
          <SectionTitle hint={`${open.length} open`}>IN PROGRESS</SectionTitle>
          <div className="space-y-2">
            {open.map((i) => (
              <Link key={i.id} to={`/inspection/${i.id}`} className="block">
                <Card className="transition-colors hover:bg-[var(--color-surface-3)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[15px] font-semibold">{inspectionTitle(i)}</p>
                      <p className="mt-0.5 text-[12px] text-[var(--color-ink)]/">Updated {relative(i.updatedAt)}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand-500/15 px-2.5 py-1 text-[11px] font-medium text-brand-300 ring-1 ring-brand-500/25">
                      Resume
                    </span>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {inspections.length === 0 && (
        <>
          <SectionTitle>GET STARTED</SectionTitle>
          <Empty
            title="No inspections yet"
            body="Start one and the app will walk you through the photos the office needs, then tell you what is missing before you leave."
          />
        </>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle hint={`${done.length} total`}>COMPLETED</SectionTitle>
          <div className="space-y-2">
            {done.slice(0, 4).map((i) => (
              <Link key={i.id} to={`/inspection/${i.id}`} className="block">
                <Card>
                  <p className="truncate text-[15px] font-semibold">{inspectionTitle(i)}</p>
                  <p className="mt-0.5 text-[12px] text-[var(--color-ink)]/">
                    {i.sentToOfficeAt
                      ? `Sent to office ${relative(i.sentToOfficeAt)}`
                      : `Completed ${relative(i.completedAt ?? i.updatedAt)}`}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {footprint > 0 && (
        <p className="mt-6 text-center text-[11px] text-[var(--color-ink)]/">
          {formatBytes(footprint)} of photos stored on this device
        </p>
      )}
    </div>
  )
}
