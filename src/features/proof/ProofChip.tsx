import { useState } from 'react'
import { headline, oldestObservation, type Proof } from './proof'

/**
 * "Show proof", as a control rather than a promise.
 *
 * The design principle is that no conclusion appears on a screen without the
 * means to open it. That is worth more to a rep than any adjective: a homeowner
 * who has been told three times this week that their roof is damaged responds
 * differently to somebody who taps a claim and shows the storm report behind it.
 *
 * An unestablished proof renders as its absence. There is no branch here that
 * prints the claim on its own — the component cannot be used to put an
 * unsupported assertion on a screen even by passing it one.
 */
export default function ProofChip({ proof }: { proof: Proof }) {
  const [open, setOpen] = useState(false)

  if (!proof.established) {
    return (
      <div className="rounded-xl bg-white/4 px-3 py-2">
        <p className="text-[12.5px] text-[var(--color-ink)]/">{proof.claim}</p>
        <p className="mt-0.5 text-[11.5px] text-[var(--color-ink)]/">{proof.because}</p>
      </div>
    )
  }

  const oldest = oldestObservation(proof)

  return (
    <div className="rounded-xl bg-white/4 px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="!min-h-0 flex w-full items-baseline justify-between gap-3 py-0.5 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0 break-words text-[13px] text-[var(--color-ink)]/">{proof.claim}</span>
        <span className="shrink-0 text-[11.5px] text-gold-300">
          {open ? 'Hide' : 'Show proof'}
        </span>
      </button>

      {!open && (
        <p className="mt-0.5 text-[11px] text-[var(--color-ink)]/">{headline(proof)}</p>
      )}

      {open && (
        <div className="mt-2 space-y-2 border-t border-white/8 pt-2">
          {proof.records.map((record, index) => (
            <div key={`${record.label}-${index}`} className="text-[12px] leading-relaxed">
              <p className="text-[var(--color-ink)]/">{record.detail}</p>
              <p className="text-[var(--color-ink)]/">
                {record.label}
                {record.observedAt !== undefined && ` · observed ${shortDate(record.observedAt)}`}
                {` · retrieved ${shortDate(record.source.retrievedAt)}`}
              </p>
              {record.href !== undefined && (
                <a href={record.href} className="text-[11.5px] text-gold-300">
                  Open this record
                </a>
              )}
            </div>
          ))}

          {/*
            The limits, shown in the same panel as the evidence rather than in
            small print somewhere else. Naming the boundaries of your own case
            before the homeowner finds them is the most persuasive thing a
            contractor can do, and it is the opposite of what the industry does.
          */}
          {proof.gaps.length > 0 && (
            <div className="border-t border-white/8 pt-2">
              <p className="text-[11px] uppercase tracking-wider text-[var(--color-ink)]/">
                What this does not show
              </p>
              <ul className="mt-1 space-y-0.5">
                {proof.gaps.map((gap) => (
                  <li key={gap} className="text-[12px] leading-relaxed text-[var(--color-ink)]/">
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {oldest !== null && (
            <p className="border-t border-white/8 pt-2 text-[11px] text-[var(--color-ink)]/">
              {/* The oldest, not the newest. A case is only as current as its
                  weakest-dated record, and the flattering number is the one
                  nobody should be quoting. */}
              Oldest record here: {shortDate(oldest)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function shortDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return 'date unreadable'
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
