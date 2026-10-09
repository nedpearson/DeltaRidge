import { Link, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { CalendarClock, ClipboardPlus, CloudLightning, History, Map as MapIcon, Navigation, Route, Target, Users } from 'lucide-react'
import type { LocalInspection } from '@/lib/db'
import { useSession } from '@/features/auth/session'
import { useRepToday } from '@/features/dashboard/useRepToday'
import HotLeadsPanel from '@/components/HotLeadsPanel'
import { StatusSummaryCard } from '@/pages/StatusPage'

export function inspectionTitle(i: LocalInspection): string {
  if (i.addressLine1) return i.addressLine1
  const name = [i.customerFirstName, i.customerLastName].filter(Boolean).join(' ')
  return name || i.customerCompanyName || 'Untitled inspection'
}

/**
 * Today — one screen, top to bottom in the order a rep needs it:
 *   1. homeowners who asked for an inspection (call them first)
 *   2. the next booked appointment
 *   3. four big buttons for everything else
 * Nothing here is a placeholder number: if there is no data, it says so.
 */

function Greeting({ title }: { title: string }) {
  const date = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <div>
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-text-muted">{date}</p>
      <h1 className="font-display text-[clamp(1.5rem,6.5vw,1.9rem)] font-bold tracking-tight text-text-primary">{title}</h1>
    </div>
  )
}

function Tile({ to, icon, label, sub }: { to: string; icon: ReactNode; label: string; sub: string }) {
  return (
    <Link to={to} className="flex min-h-[88px] flex-col justify-between rounded-2xl bg-bg-card p-3.5 ring-1 ring-border-subtle active:bg-bg-elevated">
      <span className="text-brand-hover">{icon}</span>
      <span>
        <span className="block text-[14.5px] font-bold text-text-primary">{label}</span>
        <span className="block text-[11.5px] leading-snug text-text-secondary">{sub}</span>
      </span>
    </Link>
  )
}

function NextAppointment() {
  const navigate = useNavigate()
  const { data, loading } = useRepToday()
  const appt = data?.nextAppointment ?? null
  if (loading) return <div className="rounded-2xl bg-bg-card p-4 text-sm text-text-muted ring-1 ring-border-subtle">Loading your schedule…</div>
  if (!appt) {
    return (
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-border-subtle">
        <p className="text-[14px] font-semibold text-text-primary">No appointments booked</p>
        <p className="mt-0.5 text-[12.5px] text-text-secondary">Confirm a request above and it shows up here.</p>
      </div>
    )
  }
  const when = new Date(appt.time)
  const label = Number.isFinite(when.getTime())
    ? when.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : appt.time
  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-brand-primary/40">
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brand-hover">
        <CalendarClock size={14} /> Next appointment{appt.confirmed ? '' : ' · not confirmed'}
      </div>
      <p className="mt-1.5 text-[18px] font-bold leading-tight text-text-primary">{label}</p>
      <p className="text-[13px] text-text-secondary">{appt.address}</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(appt.address)}`} target="_blank" rel="noreferrer"
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand-primary text-[14px] font-bold text-white">
          <Navigation size={16} /> Drive
        </a>
        <button type="button" disabled={!appt.leadId} onClick={() => appt.leadId && navigate(`/leads/${appt.leadId}`)}
          className="min-h-12 rounded-xl bg-bg-elevated text-[14px] font-bold text-text-primary disabled:opacity-40">
          Open lead
        </button>
      </div>
    </div>
  )
}

function RepToday() {
  return (
    <div className="space-y-5">
      <Greeting title="Today" />
      <HotLeadsPanel />
      <section>
        <h2 className="mb-2 text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">Schedule</h2>
        <NextAppointment />
      </section>
      <section className="grid grid-cols-2 gap-2.5">
        <Tile to="/mission" icon={<Route size={22} />} label="Start route" sub="GPS-logged doors, works offline" />
        <Tile to="/new" icon={<ClipboardPlus size={22} />} label="New inspection" sub="Checklist, photos, voice notes" />
        <Tile to="/map" icon={<MapIcon size={22} />} label="Map" sub="Hail, leads and your location" />
        <Tile to="/leads" icon={<Target size={22} />} label="Leads" sub="Every door, scored by storm and roof age" />
      </section>
    </div>
  )
}

function ManagerToday() {
  return (
    <div className="space-y-5">
      <Greeting title="Today" />
      <HotLeadsPanel manager />
      <StatusSummaryCard />
      <section className="grid grid-cols-2 gap-2.5">
        <Tile to="/manager" icon={<Users size={22} />} label="Team" sub="Who's out, doors, assignments" />
        <Tile to="/storm-os" icon={<CloudLightning size={22} />} label="Storms" sub="Hail swaths and target areas" />
        <Tile to="/leads" icon={<Target size={22} />} label="Pipeline" sub="All leads by stage" />
        <Tile to="/routes" icon={<History size={22} />} label="Route history" sub="Trails and door outcomes" />
      </section>
    </div>
  )
}

export default function HomePage() {
  const { membership } = useSession()
  const role = membership?.role?.toLowerCase() || 'rep'
  return role === 'admin' || role === 'manager' ? <ManagerToday /> : <RepToday />
}
