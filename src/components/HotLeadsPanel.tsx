import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Flame, Phone, MessageSquare, Navigation, CalendarCheck, X, Download, Link2 } from 'lucide-react'
import { getSupabase } from '@/lib/supabase'
import {
  insideLouisianaCallingHours,
  minutesWaiting,
  useInspectionRequests,
  type InspectionRequest,
} from '@/features/leads/useInspectionRequests'
import { buildMailerRows, mailerCsv, type MailerProperty } from '@/features/leads/mailer'

const TIER_STYLE: Record<InspectionRequest['heat_tier'], string> = {
  hot: 'bg-status-critical text-white',
  warm: 'bg-brand-gold text-[#101827]',
  cool: 'bg-bg-elevated text-text-secondary',
  not_eligible: 'bg-bg-elevated text-text-muted',
}
const TIER_LABEL: Record<InspectionRequest['heat_tier'], string> = {
  hot: 'HOT', warm: 'WARM', cool: 'NEW', not_eligible: 'RENTER',
}

function waitingLabel(mins: number): string {
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
}

function mapsUrl(r: InspectionRequest): string {
  const q = r.latitude !== null && r.longitude !== null ? `${r.latitude},${r.longitude}` : r.address_text
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`
}

function ActionButton({ href, onClick, icon, label, tone = 'secondary', disabled }: {
  href?: string | undefined
  onClick?: (() => void) | undefined
  icon: React.ReactNode
  label: string
  tone?: 'primary' | 'secondary'
  disabled?: boolean | undefined
}) {
  const cls = 'flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-bold ' +
    (disabled ? 'bg-bg-elevated text-text-disabled' : tone === 'primary' ? 'bg-status-success text-[#06231A]' : 'bg-bg-elevated text-text-primary active:bg-border-subtle')
  if (href && !disabled) {
    return <a href={href} onClick={onClick} className={cls} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{icon}{label}</a>
  }
  return <button type="button" onClick={onClick} disabled={disabled} className={cls}>{icon}{label}</button>
}

function RequestCard({ r, onStatus }: { r: InspectionRequest; onStatus: (s: 'contacted' | 'booked' | 'dismissed') => void }) {
  const navigate = useNavigate()
  const mins = minutesWaiting(r.created_at)
  const late = r.status === 'new' && mins >= 5
  const inHours = insideLouisianaCallingHours()
  const insurance = r.answers?.insurance === 'yes'
    ? `Insured${r.answers.carrier ? ` · ${r.answers.carrier}` : ''} (their answer)`
    : r.answers?.insurance === 'no' ? 'No insurance (retail)' : null

  return (
    <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-border-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={'rounded-md px-2 py-0.5 text-[11px] font-black tracking-wide ' + TIER_STYLE[r.heat_tier]}>
              {TIER_LABEL[r.heat_tier]} {r.heat_score}
            </span>
            <span className={'text-[12px] font-semibold ' + (late ? 'text-status-critical' : 'text-text-muted')}>
              {r.status === 'contacted' ? 'contacted · ' : ''}{waitingLabel(mins)}
            </span>
          </div>
          <button type="button" onClick={() => r.lead_id && navigate(`/leads/${r.lead_id}`)} className="mt-1.5 block text-left">
            <p className="truncate text-[16px] font-bold text-text-primary">{r.address_text.split(',')[0]}</p>
            <p className="text-[13px] text-text-secondary">{r.contact_name}</p>
          </button>
        </div>
        <button type="button" aria-label="Dismiss request" onClick={() => onStatus('dismissed')} className="-m-2 p-2 text-text-muted">
          <X size={18} />
        </button>
      </div>

      {r.preferred_start && (
        <p className="mt-2 rounded-lg bg-brand-primary/15 px-3 py-2 text-[13px] font-semibold text-text-primary">
          Wants {new Date(r.preferred_start).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} — confirm it
        </p>
      )}

      <ul className="mt-2 space-y-0.5 text-[12.5px] text-text-secondary">
        {r.heat_reasons.slice(0, 3).map((x) => <li key={x}>• {x}</li>)}
        {insurance && <li>• {insurance}</li>}
      </ul>

      {!inHours && r.status === 'new' && (
        <p className="mt-2 text-[11.5px] text-status-warning">
          Outside Louisiana calling hours (8am–8pm, no Sundays). They asked to be contacted, but a call first thing tomorrow is safer.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <ActionButton tone="primary" href={r.contact_phone ? `tel:${r.contact_phone}` : undefined} disabled={!r.contact_phone}
          onClick={() => { if (r.status === 'new') onStatus('contacted') }} icon={<Phone size={18} />} label="Call" />
        <ActionButton href={r.consent_given && r.contact_phone ? `sms:${r.contact_phone}` : undefined} disabled={!r.consent_given || !r.contact_phone}
          onClick={() => { if (r.status === 'new') onStatus('contacted') }} icon={<MessageSquare size={18} />} label={r.consent_given ? 'Text' : 'No text OK'} />
        <ActionButton href={mapsUrl(r)} icon={<Navigation size={18} />} label="Directions" />
        <ActionButton onClick={() => onStatus('booked')} icon={<CalendarCheck size={18} />} label="Booked" />
      </div>
    </div>
  )
}

async function exportMailer(setMsg: (m: string) => void) {
  const supabase = getSupabase()
  if (!supabase) return
  setMsg('Building list…')
  const [{ data: props, error }, { data: suppressed }, { data: closed }] = await Promise.all([
    supabase.from('properties').select('id, address_line1, city, state, postal_code, owner_name, owner_mailing_address, owner_type, roof_age_years, last_roof_permit_date').is('deleted_at', null).limit(5000),
    supabase.from('contact_preferences').select('property_id').eq('do_not_mail', true),
    supabase.from('leads').select('property_id').in('status', ['sold', 'do_not_contact', 'existing_customer']),
  ])
  if (error) { setMsg(error.message); return }
  const suppressedIds = new Set<string>([
    ...(suppressed ?? []).map((r) => r.property_id as string),
    ...(closed ?? []).map((r) => r.property_id as string),
  ].filter(Boolean))
  const now = new Date()
  const rows = buildMailerRows((props ?? []) as MailerProperty[], {
    minRoofAge: 12,
    includeUnknownAge: false,
    baseUrl: window.location.origin,
    campaign: `storm-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`,
    suppressedIds,
  }, now)
  if (rows.length === 0) { setMsg('No homes with a known roof age of 12+ years yet. Add property data first.'); return }
  const blob = new Blob([mailerCsv(rows)], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `storm-mailer-${now.toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  setMsg(`${rows.length} homes exported. Print the qr_url as a QR code on each card.`)
}

export default function HotLeadsPanel({ manager = false }: { manager?: boolean }) {
  const { items, loading, error, setStatus } = useInspectionRequests()
  const [msg, setMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const fresh = items.filter((r) => r.status === 'new').length
  const link = `${window.location.origin}/free-roof-check`

  return (
    <section aria-labelledby="hot-leads-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="hot-leads-title" className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.14em] text-text-muted">
          <Flame size={14} className="text-status-critical" /> Inspection requests
          {fresh > 0 && <span className="rounded-full bg-status-critical px-2 py-0.5 text-[11px] text-white">{fresh} new</span>}
        </h2>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-bg-card p-4 text-sm text-text-muted ring-1 ring-border-subtle">Loading…</div>
      ) : error ? (
        <div className="rounded-2xl bg-bg-card p-4 text-sm text-status-critical ring-1 ring-border-subtle">{error}</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-bg-card p-4 text-[13px] leading-relaxed text-text-secondary ring-1 ring-border-subtle">
          No open requests. Homeowners who use the storm check page land here, hottest first — no door to knock.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => (
            <RequestCard key={r.id} r={r} onStatus={(s) => void setStatus(r.id, s)} />
          ))}
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button"
          onClick={() => { void navigator.clipboard?.writeText(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 2000) }) }}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bg-card text-[12.5px] font-semibold text-text-primary ring-1 ring-border-strong">
          <Link2 size={15} /> {copied ? 'Link copied' : 'Copy storm-check link'}
        </button>
        {manager ? (
          <button type="button" onClick={() => void exportMailer(setMsg)}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bg-card text-[12.5px] font-semibold text-text-primary ring-1 ring-border-strong">
            <Download size={15} /> Mailer list (CSV)
          </button>
        ) : (
          <a href="/free-roof-check" target="_blank" rel="noreferrer"
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-bg-card text-[12.5px] font-semibold text-text-primary ring-1 ring-border-strong">
            Open the page
          </a>
        )}
      </div>
      {msg && <p className="mt-2 text-[12px] text-text-secondary">{msg}</p>}
    </section>
  )
}
