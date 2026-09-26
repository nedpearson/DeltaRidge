import { getSupabase } from '@/lib/supabase'

export interface LeadEconomicsRow {
  leadClientId: string
  leadStatus: string
  assignedTo: string | null
  opportunityScore: number | null
  leadSourceName: string | null
  leadSourceCategory: string | null
  campaignName: string | null
  address: string
  subdivision: string | null
  estimateId: string
  versionNumber: number
  sellPriceCents: number | null
  jobCostCents: number
  grossProfitCents: number | null
  grossMarginBps: number | null
  versionCreatedAt: string
  proposalSignedAt: string | null
  closedWon: boolean
}

export async function readLeadEconomics(
  orgId: string | null,
  from: string,
  to: string,
): Promise<{ rows: LeadEconomicsRow[]; error: string | null }> {
  const supabase = getSupabase()
  if (!supabase || !orgId) return { rows: [], error: null }
  if (!navigator.onLine) return { rows: [], error: 'Offline — financial attribution comes from the server.' }

  const { data, error } = await supabase
    .from('manager_lead_economics')
    .select('*')
    .eq('organization_id', orgId)
    .gte('version_created_at', from)
    .lte('version_created_at', to)
    .order('version_created_at', { ascending: false })
    .limit(5000)

  if (error) return { rows: [], error: error.message }

  return {
    rows: (data ?? []).map((row) => ({
      leadClientId: row.lead_client_id as string,
      leadStatus: row.lead_status as string,
      assignedTo: (row.assigned_to as string | null) ?? null,
      opportunityScore:
        row.opportunity_score === null ? null : Number(row.opportunity_score),
      leadSourceName: (row.lead_source_name as string | null) ?? null,
      leadSourceCategory: (row.lead_source_category as string | null) ?? null,
      campaignName: (row.campaign_name as string | null) ?? null,
      address: (row.address_line1 as string | null) ?? 'Address unavailable',
      subdivision: (row.subdivision as string | null) ?? null,
      estimateId: row.estimate_id as string,
      versionNumber: Number(row.version_number),
      sellPriceCents:
        row.sell_price_cents === null ? null : Number(row.sell_price_cents),
      jobCostCents: Number(row.job_cost_cents ?? 0),
      grossProfitCents:
        row.gross_profit_cents === null ? null : Number(row.gross_profit_cents),
      grossMarginBps:
        row.gross_margin_bps === null ? null : Number(row.gross_margin_bps),
      versionCreatedAt: row.version_created_at as string,
      proposalSignedAt: (row.proposal_signed_at as string | null) ?? null,
      closedWon: row.closed_won === true,
    })),
    error: null,
  }
}

export interface EconomicsRollup {
  estimates: number
  sold: number
  proposedRevenueCents: number
  wonRevenueCents: number
  wonGrossProfitCents: number
  averageWonMarginBps: number | null
}

export function economicsRollup(rows: readonly LeadEconomicsRow[]): EconomicsRollup {
  let proposedRevenueCents = 0
  let wonRevenueCents = 0
  let wonGrossProfitCents = 0
  let marginNumerator = 0
  let marginDenominator = 0
  let sold = 0

  for (const row of rows) {
    proposedRevenueCents += row.sellPriceCents ?? 0
    if (!row.closedWon) continue

    sold += 1
    const revenue = row.sellPriceCents ?? 0
    const grossProfit = row.grossProfitCents ?? 0
    wonRevenueCents += revenue
    wonGrossProfitCents += grossProfit
    if (revenue > 0) {
      marginNumerator += grossProfit
      marginDenominator += revenue
    }
  }

  return {
    estimates: rows.length,
    sold,
    proposedRevenueCents,
    wonRevenueCents,
    wonGrossProfitCents,
    averageWonMarginBps:
      marginDenominator > 0
        ? Math.round((marginNumerator / marginDenominator) * 10_000)
        : null,
  }
}
