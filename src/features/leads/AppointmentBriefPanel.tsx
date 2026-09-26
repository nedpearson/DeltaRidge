import { useState } from 'react'
import { Button } from '@/components/ui'
import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'
import { appointmentBriefFor } from './appointment-brief'

export default function AppointmentBriefPanel({
  lead,
  scored,
}: {
  lead: ManagedLead
  scored?: ScoredLead
}) {
  const [open, setOpen] = useState(false)
  const brief = appointmentBriefFor(lead, scored)

  return (
    <div className="mt-3">
      <Button variant="secondary" full onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide prep brief' : 'Open prep brief'}
      </Button>

      {open && (
        <div className="mt-2 rounded-xl bg-bg-page p-3 ring-1 ring-border-subtle">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {brief.title}
          </p>
          <p className="mt-1 text-[14px] font-semibold text-text-primary">{brief.homeowner}</p>
          <p className="text-[12px] text-text-secondary">{brief.address}</p>
          {brief.scheduled && (
            <p className="mt-1 text-[11.5px] text-brand-primary">
              Scheduled {new Date(brief.scheduled).toLocaleString()}
            </p>
          )}

          {brief.facts.length > 0 && (
            <div className="mt-3">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">Known facts</p>
              <ul className="mt-1 space-y-1">
                {brief.facts.map((item) => (
                  <li key={item} className="text-[11.5px] leading-relaxed text-text-secondary">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.proof.length > 0 && (
            <div className="mt-3">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">Evidence to review</p>
              <ul className="mt-1 space-y-1">
                {brief.proof.map((item) => (
                  <li key={item} className="text-[11.5px] leading-relaxed text-text-secondary">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {brief.verify.length > 0 && (
            <div className="mt-3 rounded-lg bg-warning-surface px-3 py-2 ring-1 ring-warning-border">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-status-warning">Verify on site</p>
              <ul className="mt-1 space-y-1">
                {brief.verify.map((item) => (
                  <li key={item} className="text-[11.5px] leading-relaxed text-text-secondary">
                    • {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <p className="text-[9.5px] font-semibold uppercase tracking-wider text-text-muted">Next actions</p>
            <ul className="mt-1 space-y-1">
              {brief.recommendedNext.map((item) => (
                <li key={item} className="text-[11.5px] leading-relaxed text-text-secondary">
                  • {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
