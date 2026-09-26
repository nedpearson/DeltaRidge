import type { ManagedLead } from './pipeline'
import type { ScoredLead } from './scoring'
import { proofForLead, type ProofState } from './lead-proof'

const STATE: Record<ProofState, { label: string; cls: string }> = {
  established: { label: 'Established', cls: 'text-status-success' },
  supported: { label: 'Supported', cls: 'text-brand-primary' },
  limited: { label: 'Limited', cls: 'text-status-warning' },
  blocked: { label: 'Blocked', cls: 'text-status-critical' },
}

export default function LeadProofPanel({
  scored,
  managed,
}: {
  scored: ScoredLead
  managed?: ManagedLead
}) {
  const proof = proofForLead(scored, managed)

  return (
    <div className="mt-2 rounded-xl bg-bg-page p-3 ring-1 ring-border-subtle">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
            Why this house?
          </p>
          <p className="mt-1 text-[12.5px] font-semibold leading-snug text-text-primary">
            {proof.headline}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-route-surface px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-route-live">
          Show proof
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {proof.items.map((item) => {
          const state = STATE[item.state]
          return (
            <div key={item.key} className="rounded-lg bg-bg-card px-3 py-2 ring-1 ring-border-subtle">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">{item.label}</p>
                  <p className="mt-0.5 break-words text-[12.5px] font-medium text-text-primary">
                    {item.value}
                  </p>
                  <p className="mt-0.5 break-words text-[10.5px] text-text-secondary">
                    Source: {item.source}
                  </p>
                </div>
                <span className={`shrink-0 text-[9.5px] font-semibold uppercase tracking-wider ${state.cls}`}>
                  {state.label}
                </span>
              </div>
              {item.limitation && (
                <p className="mt-1.5 break-words border-t border-border-subtle pt-1.5 text-[10.5px] leading-relaxed text-text-muted">
                  {item.limitation}
                </p>
              )}
            </div>
          )
        })}
      </div>

      {proof.limitations.length > 0 && (
        <div className="mt-3 border-t border-border-subtle pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            What still needs verification
          </p>
          <ul className="mt-1 space-y-1">
            {proof.limitations.map((item) => (
              <li key={item} className="text-[10.5px] leading-relaxed text-text-secondary">
                • {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
