import { Card, SectionTitle } from '@/components/ui'
import { integrityChecks, summarise, type CheckState, type IntegrityEvidence } from './integrity'

/**
 * Data health, as a list a person can argue with.
 *
 * Each line says what state it is in and what put it there. A rep who disagrees
 * with a line can see immediately what would change it, which is the difference
 * between a health indicator and a decoration.
 */

const TONE: Record<CheckState, { dot: string; text: string; word: string }> = {
  established: { dot: 'bg-emerald-400', text: 'text-[var(--color-ink)]/', word: 'Established' },
  reported: { dot: 'bg-white/30', text: 'text-[var(--color-ink)]/', word: 'Reported' },
  stale: { dot: 'bg-amber-400', text: 'text-[var(--color-ink)]/', word: 'Ageing' },
  absent: { dot: 'bg-white/15', text: 'text-[var(--color-ink)]/', word: 'None' },
  attention: { dot: 'bg-red-400', text: 'text-[var(--color-ink)]/', word: 'Needs attention' },
}

/** Problems first. Nothing else about the order is meaningful, so nothing else is sorted. */
const ORDER: Record<CheckState, number> = {
  attention: 0,
  stale: 1,
  established: 2,
  reported: 3,
  absent: 4,
}

export default function IntegrityPanel({ evidence }: { evidence: IntegrityEvidence }) {
  const checks = [...integrityChecks(evidence)].sort((a, b) => ORDER[a.state] - ORDER[b.state])
  const summary = summarise(checks)

  return (
    <Card>
      <SectionTitle hint="A line is only green when there is something a person could go and look at.">
        WHAT WE ACTUALLY KNOW
      </SectionTitle>

      <p
        className={`mt-2 text-sm ${summary.needsAttention > 0 ? 'text-red-300' : 'text-[var(--color-ink)]/'}`}
      >
        {summary.sentence}
      </p>

      <ul className="mt-3 space-y-2">
        {checks.map((check) => {
          const tone = TONE[check.state]
          return (
            <li key={check.key} className="flex gap-3">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`text-sm ${tone.text}`}>{check.label}</span>
                  {/* The state is spelled out rather than left to the colour, so it
                      survives a screen in sunlight and a reader who cannot tell
                      amber from green. */}
                  <span className="text-xs text-[var(--color-ink)]/">{tone.word}</span>
                </div>
                <p className="text-xs text-[var(--color-ink)]/">{check.basis}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
