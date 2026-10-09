import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Card, PageHeader, SectionTitle } from '@/components/ui'
import { summarize, useCapabilities, type Capability, type CapabilityGroup, type CapabilityState } from '@/features/system/capabilities'

export const STATE_UI: Record<CapabilityState, { dot: string; word: string }> = {
  live: { dot: 'bg-status-success', word: 'Live' },
  partial: { dot: 'bg-brand-gold', word: 'Partly live' },
  not_connected: { dot: 'bg-text-disabled', word: 'Not set up' },
  off: { dot: 'bg-text-disabled', word: 'Off' },
  error: { dot: 'bg-status-critical', word: 'Problem' },
  checking: { dot: 'bg-bg-elevated', word: 'Checking…' },
  unknown: { dot: 'bg-bg-elevated', word: 'Sign in' },
}

const GROUPS: readonly CapabilityGroup[] = ['Finding leads', 'In the field', 'Office & follow-up', 'Marketing']

function Row({ c }: { c: Capability }) {
  const ui = STATE_UI[c.state]
  return (
    <Link to={c.to} className="flex min-h-14 items-start gap-3 rounded-xl px-3 py-3 active:bg-bg-elevated">
      <span className={'mt-1.5 size-2.5 shrink-0 rounded-full ' + ui.dot} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[14.5px] font-semibold text-text-primary">{c.name}</span>
          <span className="shrink-0 text-[11.5px] font-bold uppercase tracking-wide text-text-muted">{ui.word}</span>
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-text-secondary">{c.does}</span>
        <span className="mt-1 block text-[12px] leading-snug text-text-muted">{c.detail}</span>
      </span>
      <ChevronRight size={16} className="mt-1 shrink-0 text-text-muted" />
    </Link>
  )
}

export default function StatusPage() {
  const caps = useCapabilities()
  const s = summarize(caps)
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="System" title="What's live"
        description={`${s.live} working${s.problems ? ` · ${s.problems} with a problem` : ''} · ${s.setup} not set up yet. Tap any line to use it or switch it on.`} />
      {GROUPS.map((g) => (
        <div key={g}>
          <SectionTitle>{g.toUpperCase()}</SectionTitle>
          <Card className="!p-1">
            {caps.filter((c) => c.group === g).map((c, i) => (
              <div key={c.id}>{i > 0 && <div className="mx-3 border-t border-border-subtle" />}<Row c={c} /></div>
            ))}
          </Card>
        </div>
      ))}
      <p className="text-center text-[12px] text-text-muted">
        Detailed connection history: <Link to="/settings?tab=integrations" className="font-semibold text-brand-hover">Settings → Integrations</Link>
      </p>
    </div>
  )
}

/** The one-line version for the Today screen. */
export function StatusSummaryCard() {
  const caps = useCapabilities()
  const s = summarize(caps)
  const problems = caps.filter((c) => c.state === 'error')
  return (
    <Link to="/status" className="flex min-h-14 items-center justify-between gap-3 rounded-2xl bg-bg-card px-4 py-3 ring-1 ring-border-subtle active:bg-bg-elevated">
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-text-primary">What's live</span>
        <span className="block truncate text-[12.5px] text-text-secondary">
          {problems.length ? `Problem: ${problems.map((p) => p.name).join(', ')}` : `${s.live} working · ${s.setup} not set up`}
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        {problems.length > 0 && <span className="size-2.5 rounded-full bg-status-critical" />}
        <ChevronRight size={16} className="text-text-muted" />
      </span>
    </Link>
  )
}
