import { getSupabase } from '@/lib/supabase'

export interface QuotedLeadEconomics {
  leadClientId: string
  leadStatus: string
  opportunityScore: number | null
  versionNumber: number
  sellPriceCents: number | null
  jobCostCents: number
  quotedGrossMarginCents: number | null
  pricedAt: string
}

export async function readQuotedEconomics(
  organizationId: string | null,
): Promise<{ rows: QuotedLeadEconomics[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !organizationId) return { rows: [], error: null }

  const { data, error } = await supabase
    .from('lead_quoted_economics')
    .select(
      'lead_client_id, lead_status, opportunity_score, version_number, sell_price_cents, job_cost_cents, quoted_gross_margin_cents, priced_at',
    )
    .eq('organization_id', organizationId)
    .order('priced_at', { ascending: false })

  if (error) return { rows: [], error: error.message }

  return {
    rows: ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      leadClientId: row['lead_client_id'] as string,
      leadStatus: row['lead_status'] as string,
      opportunityScore:
        row['opportunity_score'] === null ? null : Number(row['opportunity_score']),
      versionNumber: Number(row['version_number']),
      sellPriceCents:
        row['sell_price_cents'] === null ? null : Number(row['sell_price_cents']),
      jobCostCents: Number(row['job_cost_cents']),
      quotedGrossMarginCents:
        row['quoted_gross_margin_cents'] === null
          ? null
          : Number(row['quoted_gross_margin_cents']),
      pricedAt: row['priced_at'] as string,
    })),
    error: null,
  }
}

export function sumQuotedEconomics(rows: readonly QuotedLeadEconomics[]) {
  return rows.reduce(
    (acc, row) => ({
      proposals: acc.proposals + 1,
      quotedRevenueCents: acc.quotedRevenueCents + (row.sellPriceCents ?? 0),
      quotedMarginCents:
        acc.quotedMarginCents + (row.quotedGrossMarginCents ?? 0),
    }),
    { proposals: 0, quotedRevenueCents: 0, quotedMarginCents: 0 },
  )
}
