import { useMemo, useState } from 'react'
import { evaluateLeadIntelligence } from './intelligence'
import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'

function contactSource(managed?: ManagedLead): 'homeowner' | 'public_record' | 'third_party_lookup' | 'unknown' | 'none' {
  if (!managed?.contactPhone && !managed?.contactEmail) return 'none'
  const source = managed.contactSource
  if (
    source === 'homeowner_at_door' ||
    source === 'homeowner_by_phone' ||
    source === 'homeowner_in_writing'
  ) {
    return 'homeowner'
  }
  if (source === 'public_record') return 'public_record'
  if (source === 'third_party_lookup') return 'third_party_lookup'
  return 'unknown'
}

const CERT_LABEL = {
  ultimate: 'ULTIMATE LEAD',
  strong: 'STRONG OPPORTUNITY',
  developing: 'DEVELOPING',
  insufficient: 'INSUFFICIENT',
} as const

export default function LeadIntelligenceSummary({
  lead,
  managed,
}: {
  lead: ScoredLead
  managed?: ManagedLead
}) {
  const [open, setOpen] = useState(false)

  const result = useMemo(() => {
    const source = contactSource(managed)
    return evaluateLeadIntelligence({
      scored: lead,
      ...(managed ? { managed } : {}),
      // Imagery and measurements only count once the canonical record has
      // evidence for them. A map tile or an EagleView button is not enough.
      hasCurrentImagery: false,
      hasRoofMeasurement: false,
      ownerIdentified: Boolean(lead.parcel?.ownerName),
      ownerOccupied:
        lead.parcel?.occupancy === 'owner_occupied'
          ? true
          : lead.parcel?.occupancy === 'likely_absentee'
            ? false
            : null,
      phonePresent: Boolean(managed?.contactPhone),
      emailPresent: Boolean(managed?.contactEmail),
      contactConfirmed: source === 'homeowner',
      contactSource: source,
      optedOut: managed?.optedOutAt !== undefined || managed?.status === 'do_not_knock',
      appointmentConfirmed: managed?.status === 'appointment',
    })
  }, [lead, managed])

  return (
    <div className="mt-3 rounded-xl border border-border-subtle bg-bg-elevated/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-[10px] uppercase tracking-widest text-brand-gold">
            {CERT_LABEL[result.certification]}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-text-secondary">
            Three separate evidence indexes. These are not a probability of closing.
          </p>
        </div>
        <p className="font-display text-xl text-brand-gold">{result.overallPriority}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-bg-card p-2 text-center">
          <p className="font-display text-lg text-brand-gold">{result.propertyScore}</p>
          <p className="text-[9px] uppercase tracking-wider text-text-muted">Property</p>
        </div>
        <div className="rounded-lg bg-bg-card p-2 text-center">
          <p className="font-display text-lg text-status-ai">{result.intentScore}</p>
          <p className="text-[9px] uppercase tracking-wider text-text-muted">Intent</p>
        </div>
        <div className="rounded-lg bg-bg-card p-2 text-center">
          <p className="font-display text-lg text-route-live">{result.contactabilityScore}</p>
          <p className="text-[9px] uppercase tracking-wider text-text-muted">Reach</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-2 w-full !min-h-0 py-1 text-[10.5px] font-semibold text-route-live"
      >
        {open ? 'Hide proof' : 'Why this house? / Show me the proof'}
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-border-subtle pt-2">
          {result.propertyReasons.map((reason) => (
            <p key={reason.label} className="text-[11px] leading-relaxed text-text-secondary">
              <span className="font-semibold text-text-primary">{reason.label}:</span> {reason.detail}
            </p>
          ))}
          {result.intentReasons.map((reason) => (
            <p key={reason.label} className="text-[11px] leading-relaxed text-text-secondary">
              <span className="font-semibold text-status-ai">{reason.label}:</span> {reason.detail}
            </p>
          ))}
          {result.contactabilityReasons.map((reason) => (
            <p key={reason.label} className="text-[11px] leading-relaxed text-text-secondary">
              <span className="font-semibold text-route-live">{reason.label}:</span> {reason.detail}
            </p>
          ))}
          {result.missingRequirements.length > 0 && (
            <p className="text-[10.5px] leading-relaxed text-status-warning">
              To strengthen this lead: {result.missingRequirements.join(', ')}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
