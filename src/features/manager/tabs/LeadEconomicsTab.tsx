import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Empty, SectionTitle } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'

interface Row {
  leadId: string
  leadClientId: string
  status: string
  funnelStage: string
  sourceName: string | null
  campaignName: string | null
  opportunity: number | null
  intent: number | null
  contactability: number | null
  level: string | null
  contractValueCents: number | null
  estimatedGrossProfitCents: number | null
  valueBasis: string | null
}

function dollars(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(cents / 100)
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export default function LeadEconomicsTab({
  organizationId,
  onOpenLead,
}: {
  organizationId: string | null
  onOpenLead: (leadClientId: string) => void
}) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openStage, setOpenStage] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = getSupabase()
    if (!supabase || !organizationId) {
      setRows([])
      setLoading(false)
      return
    }

    const { data, error: readError } = await supabase
      .from('lead_outcome_attribution')
      .select(
        'lead_id, lead_client_id, status, funnel_stage, lead_source_name, campaign_name, ' +
          'opportunity_score, intent_score, contactability_score, intelligence_level, ' +
          'attributed_contract_value_cents, estimated_gross_profit_cents, value_basis',
      )
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1000)

    if (readError) {
      setError(readError.message)
      setRows([])
      setLoading(false)
      return
    }

    setRows(
      ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
        leadId: String(row['lead_id']),
        leadClientId: String(row['lead_client_id']),
        status: String(row['status']),
        funnelStage: String(row['funnel_stage']),
        sourceName: (row['lead_source_name'] as string | null) ?? null,
        campaignName: (row['campaign_name'] as string | null) ?? null,
        opportunity: number(row['opportunity_score']),
        intent: number(row['intent_score']),
        contactability: number(row['contactability_score']),
        level: (row['intelligence_level'] as string | null) ?? null,
        contractValueCents: number(row['attributed_contract_value_cents']),
        estimatedGrossProfitCents: number(row['estimated_gross_profit_cents']),
        valueBasis: (row['value_basis'] as string | null) ?? null,
      })),
    )
    setLoading(false)
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  const summary = useMemo(() => {
    const won = rows.filter((row) => row.funnelStage === 'won')
    const appointments = rows.filter((row) =>
      ['appointment', 'inspected', 'proposal', 'won'].includes(row.funnelStage),
    )
    const contract = won.reduce((sum, row) => sum + (row.contractValueCents ?? 0), 0)
    const gp = won.reduce((sum, row) => sum + (row.estimatedGrossProfitCents ?? 0), 0)

    return {
      leads: rows.length,
      appointments: appointments.length,
      won: won.length,
      contract,
      gp,
      closeRate: rows.length > 0 ? won.length / rows.length : null,
    }
  }, [rows])

  const stages = useMemo(() => {
    const order = ['target', 'contacted', 'engaged', 'appointment', 'inspected', 'proposal', 'won', 'lost']
    const map = new Map<string, number>()
    for (const row of rows) map.set(row.funnelStage, (map.get(row.funnelStage) ?? 0) + 1)
    return order.map((stage) => ({ stage, count: map.get(stage) ?? 0 }))
  }, [rows])

  const bySource = useMemo(() => {
    const map = new Map<string, { leads: number; won: number; value: number; gp: number }>()
    for (const row of rows) {
      const key = row.sourceName ?? row.campaignName ?? 'Unattributed'
      const current = map.get(key) ?? { leads: 0, won: 0, value: 0, gp: 0 }
      current.leads += 1
      if (row.funnelStage === 'won') {
        current.won += 1
        current.value += row.contractValueCents ?? 0
        current.gp += row.estimatedGrossProfitCents ?? 0
      }
      map.set(key, current)
    }
    return [...map.entries()]
      .map(([name, values]) => ({ name, ...values }))
      .sort((a, b) => b.gp - a.gp || b.won - a.won || b.leads - a.leads)
  }, [rows])

  if (loading) {
    return <Card><p className="text-[13px] text-text-secondary">Reading lead economics…</p></Card>
  }

  if (error) {
    return (
      <Card className="bg-warning-surface ring-1 ring-warning-border">
        <p className="text-[13px] font-semibold text-status-warning">Lead economics is not available yet.</p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-text-secondary">{error}</p>
        <Button variant="secondary" full className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </Card>
    )
  }

  if (rows.length === 0) {
    return (
      <Empty
        title="No attributed outcomes yet"
        body="Once leads reach the server and progress through appointments, estimates and Roofr, this tab shows which opportunities actually became signed work."
      />
    )
  }

  return (
    <div className="space-y-3">
      <Card>
        <SectionTitle hint="Current server records, not a forecast">LEAD ECONOMICS</SectionTitle>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Metric value={String(summary.leads)} label="tracked leads" />
          <Metric value={String(summary.appointments)} label="appointment+" />
          <Metric value={String(summary.won)} label="won" />
          <Metric value={dollars(summary.contract)} label="contract value" />
          <Metric value={dollars(summary.gp)} label="est. gross profit" />
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed text-text-muted">
          Contract value counts only a signed Roofr proposal or a Delta Ridge lead explicitly marked sold.
          Estimated gross profit subtracts the latest estimate job cost; it is not cash collected or final job-cost actuals.
        </p>
      </Card>

      <Card>
        <SectionTitle hint={summary.closeRate === null ? 'No denominator yet' : `${Math.round(summary.closeRate * 100)}% won / tracked`}>
          FUNNEL
        </SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {stages.map(({ stage, count }) => (
            <button
              key={stage}
              type="button"
              onClick={() => setOpenStage(openStage === stage ? null : stage)}
              className={`rounded-xl px-3 py-2 text-left ring-1 ${
                openStage === stage
                  ? 'bg-brand-primary/12 ring-brand-primary/30'
                  : 'bg-bg-page ring-border-subtle'
              }`}
            >
              <p className="font-display text-[18px] text-text-primary">{count}</p>
              <p className="mt-0.5 text-[9.5px] uppercase tracking-wider text-text-muted">
                {stage}
              </p>
            </button>
          ))}
        </div>

        {openStage && (
          <div className="mt-3 border-t border-border-subtle pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              Supporting records · {openStage}
            </p>
            <div className="mt-2 space-y-2">
              {rows
                .filter((row) => row.funnelStage === openStage)
                .map((row) => (
                  <button
                    key={row.leadId}
                    type="button"
                    onClick={() => onOpenLead(row.leadClientId)}
                    className="w-full rounded-xl bg-bg-page px-3 py-2 text-left ring-1 ring-border-subtle"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[12px] font-medium text-text-primary">
                        {row.level?.replaceAll('_', ' ') ?? 'lead'}
                      </span>
                      <span className="text-[10.5px] text-text-muted">
                        {row.contractValueCents ? dollars(row.contractValueCents) : 'Open Lead 360'}
                      </span>
                    </div>
                    <p className="mt-1 text-[10.5px] text-text-secondary">
                      Opportunity {row.opportunity ?? '—'} · Intent {row.intent ?? '—'} · Contact {row.contactability ?? '—'}
                    </p>
                  </button>
                ))}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle hint="Ranks by estimated gross profit already won, not ad clicks">BY SOURCE / CAMPAIGN</SectionTitle>
        <div className="mt-2 space-y-2">
          {bySource.map((row) => (
            <div key={row.name} className="rounded-xl bg-bg-page px-3 py-2 ring-1 ring-border-subtle">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 truncate text-[12.5px] font-medium text-text-primary">{row.name}</p>
                <p className="shrink-0 text-[12px] font-semibold text-brand-gold">{dollars(row.gp)}</p>
              </div>
              <p className="mt-1 text-[10.5px] text-text-secondary">
                {row.leads} leads · {row.won} won · {dollars(row.value)} contract value
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-bg-page px-3 py-2 ring-1 ring-border-subtle">
      <p className="font-display text-[18px] leading-none text-text-primary">{value}</p>
      <p className="mt-1 text-[9px] uppercase tracking-wider text-text-muted">{label}</p>
    </div>
  )
}
