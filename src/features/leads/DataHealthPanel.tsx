import { Button, Card, SectionTitle } from '@/components/ui'
import type { DataHealthIssue, FixTarget } from './data-health'

const TONE = {
  blocker: {
    badge: 'bg-red-500/10 text-red-300 ring-red-500/20',
    label: 'BLOCKER',
  },
  review: {
    badge: 'bg-amber-500/10 text-amber-200 ring-amber-500/20',
    label: 'REVIEW',
  },
  warning: {
    badge: 'bg-white/6 text-white/45 ring-white/10',
    label: 'CHECK',
  },
} as const

export default function DataHealthPanel({
  issues,
  onFix,
}: {
  issues: readonly DataHealthIssue[]
  onFix: (target: FixTarget) => void
}) {
  const blockers = issues.filter((issue) => issue.severity === 'blocker').length
  const reviews = issues.filter((issue) => issue.severity === 'review').length

  return (
    <>
      <SectionTitle hint="Conflicts are surfaced; the app does not silently choose a winner.">
        DATA HEALTH / CONFLICTS
      </SectionTitle>

      {issues.length === 0 ? (
        <Card className="!py-3">
          <p className="text-[12.5px] text-emerald-300/85">No actionable conflicts found.</p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-white/30">
            This does not mean every field is complete. It means the sources currently loaded do
            not contradict each other or require an immediate correction.
          </p>
        </Card>
      ) : (
        <Card>
          <p className="text-[12.5px] text-white/65">
            {blockers > 0
              ? `${blockers} blocker${blockers === 1 ? '' : 's'}`
              : reviews > 0
                ? `${reviews} item${reviews === 1 ? '' : 's'} need review`
                : `${issues.length} item${issues.length === 1 ? '' : 's'} to check`}
          </p>

          <div className="mt-3 space-y-3">
            {issues.map((issue) => {
              const tone = TONE[issue.severity]
              return (
                <div key={issue.key} className="rounded-xl bg-white/3 p-3 ring-1 ring-white/8">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words text-[13px] font-semibold text-white/85">
                        {issue.title}
                      </p>
                      <p className="mt-1 break-words text-[11.5px] leading-relaxed text-white/45">
                        {issue.detail}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-semibold tracking-wider ring-1 ${tone.badge}`}
                    >
                      {tone.label}
                    </span>
                  </div>

                  <Button variant="secondary" full className="mt-3" onClick={() => onFix(issue.target)}>
                    Fix Now
                  </Button>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </>
  )
}
