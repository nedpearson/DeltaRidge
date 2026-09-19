import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { listInspections, localStorageFootprint, type LocalInspection } from '@/lib/db'
import { backendStatus } from '@/lib/backend'
import AccountPanel from '@/features/auth/AccountPanel'

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
  const backend = backendStatus()

  useEffect(() => {
    void listInspections().then(setInspections)
    void localStorageFootprint().then(setFootprint)
  }, [])

  const open = inspections.filter((i) => i.status === 'in_progress')
  const done = inspections.filter((i) => i.status === 'complete')

  return (
    <div>
      <div className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 ring-1 ring-white/10">
        <p className="font-display text-lg leading-tight tracking-wide">
          Document the roof.
          <br />
          Leave with nothing missing.
        </p>
        <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-white/60">
          Guided capture, on-device quality checks, and a completeness review before you drive away.
        </p>
        <Button variant="gold" full className="mt-4" onClick={() => navigate('/new')}>
          Start an inspection
        </Button>
      </div>

      {!backend.configured && (
        <Card className="mt-4 !bg-amber-500/8 ring-amber-500/20">
          <p className="text-[12px] leading-relaxed text-amber-200/90">{backend.reason}</p>
        </Card>
      )}

      <AccountPanel />

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
                      <p className="mt-0.5 text-[12px] text-white/40">Updated {relative(i.updatedAt)}</p>
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
                  <p className="mt-0.5 text-[12px] text-white/40">
                    Completed {i.completedAt ? relative(i.completedAt) : relative(i.updatedAt)}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      {footprint > 0 && (
        <p className="mt-6 text-center text-[11px] text-white/25">
          {formatBytes(footprint)} of photos stored on this device
        </p>
      )}
    </div>
  )
}
