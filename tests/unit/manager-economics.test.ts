import { describe, expect, it } from 'vitest'
import { economicsRollup, type LeadEconomicsRow } from '@/features/manager/economics'

function row(over: Partial<LeadEconomicsRow> = {}): LeadEconomicsRow {
  return {
    leadClientId: 'lead-1',
    leadStatus: 'proposal_pending',
    assignedTo: 'rep-1',
    opportunityScore: 80,
    leadSourceName: 'Storm intelligence',
    leadSourceCategory: 'storm',
    campaignName: null,
    address: '123 Main St',
    subdivision: 'Oak Hills',
    estimateId: 'estimate-1',
    versionNumber: 1,
    sellPriceCents: 2_000_000,
    jobCostCents: 1_200_000,
    grossProfitCents: 800_000,
    grossMarginBps: 4000,
    versionCreatedAt: '2026-09-25T12:00:00Z',
    proposalSignedAt: null,
    closedWon: false,
    ...over,
  }
}

describe('lead economics attribution', () => {
  it('does not count unsigned proposal value as won revenue', () => {
    const result = economicsRollup([row()])
    expect(result.proposedRevenueCents).toBe(2_000_000)
    expect(result.wonRevenueCents).toBe(0)
    expect(result.wonGrossProfitCents).toBe(0)
    expect(result.sold).toBe(0)
  })

  it('rolls won revenue and gross profit from server-backed closed-won rows', () => {
    const result = economicsRollup([
      row({ closedWon: true, proposalSignedAt: '2026-09-25T18:00:00Z' }),
      row({
        leadClientId: 'lead-2',
        estimateId: 'estimate-2',
        sellPriceCents: 1_500_000,
        jobCostCents: 1_050_000,
        grossProfitCents: 450_000,
        grossMarginBps: 3000,
        closedWon: true,
      }),
    ])

    expect(result.estimates).toBe(2)
    expect(result.sold).toBe(2)
    expect(result.wonRevenueCents).toBe(3_500_000)
    expect(result.wonGrossProfitCents).toBe(1_250_000)
    expect(result.averageWonMarginBps).toBe(3571)
  })

  it('does not fabricate a margin when won revenue is zero', () => {
    const result = economicsRollup([
      row({
        sellPriceCents: null,
        grossProfitCents: null,
        closedWon: true,
      }),
    ])

    expect(result.averageWonMarginBps).toBeNull()
  })
})
