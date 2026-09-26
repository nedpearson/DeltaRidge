import { useMemo, useState } from 'react'
import { Button, Card } from '@/components/ui'
import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'
import { assessUltimateLead, ULTIMATE_TIER_LABEL } from './ultimate-lead'

function tone(value: number): string {
  if (value >= 70) return 'text-status-success'
  if (value >= 40) return 'text-gold-300'
  return 'text-text-secondary'
}

function Score({
  value,
  label,
}: {
  value: number
  label: string
}) {
  return (
    <div className="min-w-0 rounded-xl bg-bg-elevated px-3 py-2 ring-1 ring-border-subtle">
      <p className={`font-display text-xl leading-none ${tone(value)}`}>{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wider text-text-secondary">{label}</p>
    </div>
  )
}

export default function LeadIntelligenceCard({
  lead,
  managed,
  onOpenProperty,
}: {
  lead: ScoredLead
  managed?: ManagedLead
  onOpenProperty: () => void
}) {
  const [open, setOpen] = useState(false)
  const assessment = useMemo(
    () => assessUltimateLead({ scored: lead, ...(managed ? { managed } : {}) }),
    [lead, managed],
  )

  const badgeTone =
    assessment.tier === 'ultimate'
      ? 'bg-gold-500/15 text-gold-300 ring-gold-400/30'
      : assessment.tier === 'prime_target'
        ? 'bg-brand-primary/15 text-brand-300 ring-brand-primary/30'
        : assessment.tier === 'blocked'
          ? 'bg-status-critical/10 text-status-critical ring-status-critical/25'
          : 'bg-bg-elevated text-text-secondary ring-border-subtle'

  return (
    <Card className="mt-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10.5px] uppercase tracking-[0.18em] text-text-secondary">
            Delta Ridge Intelligence
          </p>
          <p className="mt-1 text-[14px] font-semibold text-text-primary">
            {ULTIMATE_TIER_LABEL[assessment.tier]}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ${badgeTone}`}>
          {assessment.tier === 'ultimate'
            ? 'CERTIFIED'
            : assessment.tier === 'blocked'
              ? 'DO NOT CONTACT'
              : 'RANKED'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Score value={assessment.propertyOpportunity.score} label="Property" />
        <Score value={assessment.homeownerIntent.score} label="Intent" />
        <Score value={assessment.contactability.score} label="Reachable" />
      </div>

      <p className="mt-2 text-[10.5px] leading-relaxed text-text-secondary">
        These are transparent operating signals, not sale probabilities. Property ranks the roof;
        intent reflects witnessed homeowner actions; reachable reflects contact data and recorded
        permission.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setOpen((value) => !value)}>
          {open ? 'Hide why' : 'Why this house?'}
        </Button>
        <Button variant="secondary" onClick={onOpenProperty}>
          Show the proof
        </Button>
      </div>

      {open && (
        <div className="mt-3 space-y-3 border-t border-border-subtle pt-3">
          {[
            assessment.propertyOpportunity,
            assessment.homeownerIntent,
            assessment.contactability,
          ].map((signal) => (
            <div key={signal.label}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
                {signal.label} · {signal.score}
              </p>
              <ul className="mt-1 space-y-1">
                {signal.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2 text-[11.5px] leading-relaxed text-text-secondary">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-live" />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {assessment.blockedReason && (
            <p className="rounded-lg bg-status-critical/10 px-3 py-2 text-[11.5px] text-status-critical ring-1 ring-status-critical/20">
              {assessment.blockedReason}
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
