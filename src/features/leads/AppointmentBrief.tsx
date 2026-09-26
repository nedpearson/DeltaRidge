import { useEffect, useMemo, useState } from 'react'
import { Button, Card, SectionTitle } from '@/components/ui'
import { readCachedRun } from './engine'
import type { ContactEvent, ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'
import { assessUltimateLead } from './ultimate-lead'

function shortWhen(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}

/**
 * One-minute prep before a rep gets out of the truck.
 *
 * It deliberately says what is known and what is not. A reason to inspect is
 * useful; an invented diagnosis before seeing the roof is not.
 */
export default function AppointmentBrief({
  lead,
  history,
  onOpenProperty,
}: {
  lead: ManagedLead
  history: readonly ContactEvent[]
  onOpenProperty: () => void
}) {
  const [scored, setScored] = useState<ScoredLead | null>(null)

  useEffect(() => {
    let active = true
    void readCachedRun().then((run) => {
      if (!active) return
      setScored(run?.leads.find((row) => row.addressKey === lead.addressKey) ?? null)
    })
    return () => {
      active = false
    }
  }, [lead.addressKey])

  const assessment = useMemo(
    () => (scored ? assessUltimateLead({ scored, managed: lead, history }) : null),
    [history, lead, scored],
  )

  if (!['appointment', 'need_visit', 'inspected'].includes(lead.status)) return null

  return (
    <>
      <SectionTitle hint="One-minute prep">APPOINTMENT BRIEF</SectionTitle>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-[15px] font-semibold text-text-primary">
              {lead.contactName ?? 'Homeowner identity not confirmed'}
            </p>
            <p className="mt-0.5 break-words text-[12px] text-text-secondary">{lead.address}</p>
          </div>
          {lead.appointmentAt && (
            <span className="shrink-0 rounded-full bg-gold-500/15 px-2.5 py-1 text-[10.5px] font-semibold text-gold-300 ring-1 ring-gold-400/20">
              {shortWhen(lead.appointmentAt)}
            </span>
          )}
        </div>

        {assessment && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['Property', assessment.propertyOpportunity.score],
              ['Intent', assessment.homeownerIntent.score],
              ['Reachable', assessment.contactability.score],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl bg-bg-elevated px-2.5 py-2 ring-1 ring-border-subtle">
                <p className="font-display text-lg leading-none text-text-primary">{String(value)}</p>
                <p className="mt-1 text-[9.5px] uppercase tracking-wider text-text-secondary">
                  {String(label)}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3">
          <p className="text-[10.5px] uppercase tracking-wider text-text-secondary">
            Why this property is on the list
          </p>
          {scored ? (
            <ul className="mt-1 space-y-1">
              {scored.reasons.slice(0, 5).map((reason) => (
                <li key={reason} className="flex gap-2 text-[11.5px] leading-relaxed text-text-secondary">
                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-brand-live" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
              The original property-intelligence run is not on this device. Open the property record
              for currently available evidence instead of guessing.
            </p>
          )}
        </div>

        <div className="mt-3 rounded-xl bg-bg-elevated px-3 py-2 ring-1 ring-border-subtle">
          <p className="text-[10.5px] uppercase tracking-wider text-text-secondary">
            Do not assume before inspection
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">
            Storm proximity, roof age and aerial imagery can justify an inspection. They do not by
            themselves establish current roof damage, cause of loss or insurance coverage.
          </p>
        </div>

        <Button variant="secondary" full className="mt-3" onClick={onOpenProperty}>
          Open property evidence
        </Button>
      </Card>
    </>
  )
}
