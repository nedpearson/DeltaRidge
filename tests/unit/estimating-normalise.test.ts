import { describe, expect, it } from 'vitest'
import {
  analyseGap,
  compareScopes,
  likeForLikeTotal,
  normalisedScope,
  type ComponentState,
  type ScopeComponentKey,
} from '@/features/estimating/normalise'
import { dollarsToCents, percentToBps, type Cents } from '@/features/estimating/money'
import {
  estimateClose,
  priceOptions,
  recommendStrategy,
  type CloseFactors,
} from '@/features/estimating/strategy'
import type { MarginPolicy } from '@/features/estimating/margin'
import type { PriceLinkedRates } from '@/features/estimating/cost'

const m = (entries: [ScopeComponentKey, ComponentState][]) =>
  new Map<ScopeComponentKey, ComponentState>(entries)

const ours = normalisedScope('delta_ridge', 'Delta Ridge', dollarsToCents(18_050), m([
  ['field_shingle', { kind: 'included', detail: 'Premium architectural' }],
  ['drip_edge', { kind: 'included', detail: null }],
  ['pipe_boots', { kind: 'included', detail: '3 replaced' }],
  ['ridge_vent', { kind: 'included', detail: null }],
  ['permit', { kind: 'included', detail: null }],
  ['cleanup', { kind: 'included', detail: null }],
  ['warranty_workmanship', { kind: 'included', detail: '10 years' }],
]))

const theirs = normalisedScope('competitor', 'Competitor A', dollarsToCents(16_900), m([
  ['field_shingle', { kind: 'included', detail: 'Standard architectural' }],
  ['pipe_boots', { kind: 'excluded', detail: 'Reuse existing' }],
  ['permit', { kind: 'excluded', detail: null }],
  ['warranty_workmanship', { kind: 'included', detail: '5 years' }],
]))

const COST: Partial<Record<ScopeComponentKey, Cents>> = {
  pipe_boots: dollarsToCents(180),
  permit: dollarsToCents(150),
  ridge_vent: dollarsToCents(420),
  drip_edge: dollarsToCents(310),
}
const ourCost = (k: ScopeComponentKey): Cents | null => COST[k] ?? null

describe('unknown is never treated as excluded', () => {
  it('reports an unmentioned component as not specified', () => {
    const rows = compareScopes(ours, theirs)
    const dripEdge = rows.find((r) => r.key === 'drip_edge')
    expect(dripEdge?.verdict).toBe('not_specified')
    expect(dripEdge?.statement).toContain('not specified')
    expect(dripEdge?.statement).toContain('Ask them to confirm')
  })

  it('keeps an unmentioned component out of the explained total', () => {
    const gap = analyseGap(ours, theirs, ourCost)
    expect(gap?.attributed.map((a) => a.key)).not.toContain('drip_edge')
    expect(gap?.notSpecified).toContain('drip_edge')
    expect(gap?.notSpecified).toContain('ridge_vent')
  })

  it('fills in every component so nothing is silently absent', () => {
    expect(compareScopes(ours, theirs)).toHaveLength(20)
  })
})

describe('the gap is attributed only to documented differences', () => {
  it('attributes what they explicitly exclude and we include', () => {
    const gap = analyseGap(ours, theirs, ourCost)
    expect(gap?.attributed.map((a) => a.key).sort()).toEqual(['permit', 'pipe_boots'])
    expect(gap?.explained).toBe(dollarsToCents(330))
  })

  it('states whose cost the attribution uses', () => {
    const gap = analyseGap(ours, theirs, ourCost)
    for (const a of gap?.attributed ?? []) {
      expect(a.basis).toContain('Delta Ridge cost')
      expect(a.basis).toContain('not known')
    }
  })

  it('reports the unexplained remainder honestly', () => {
    const gap = analyseGap(ours, theirs, ourCost)
    expect(gap?.gap).toBe(dollarsToCents(1_150))
    expect(gap?.unexplained).toBe(dollarsToCents(820))
    expect(gap?.summary).toContain('$820.00 is not')
  })

  it('does not manufacture an explanation when there is none', () => {
    const gap = analyseGap(ours, theirs, () => null)
    expect(gap?.explained).toBe(0)
    expect(gap?.summary).toContain('none of it is explained')
  })

  it('says there is nothing to explain when we are cheaper', () => {
    const cheaper = normalisedScope('delta_ridge', 'Delta Ridge', dollarsToCents(16_000), m([]))
    expect(analyseGap(cheaper, theirs, ourCost)?.summary).toContain('no gap to explain')
  })

  it('returns null rather than guessing when a total is missing', () => {
    const noTotal = normalisedScope('competitor', 'B', null, m([]))
    expect(analyseGap(ours, noTotal, ourCost)).toBeNull()
    expect(likeForLikeTotal(null)).toBeNull()
  })

  it('builds a like-for-like total from their price plus our cost', () => {
    const gap = analyseGap(ours, theirs, ourCost)
    expect(likeForLikeTotal(gap)).toBe(dollarsToCents(17_230))
  })

  it('flags a material difference rather than calling it a match', () => {
    const rows = compareScopes(ours, theirs)
    expect(rows.find((r) => r.key === 'field_shingle')?.verdict).toBe('differs')
    expect(rows.find((r) => r.key === 'warranty_workmanship')?.verdict).toBe('differs')
  })
})

const policy: MarginPolicy = {
  standardMargin: percentToBps(38),
  targetMargin: percentToBps(35),
  floorMargin: percentToBps(30),
  stopMargin: percentToBps(26),
}
const JOB_COST = dollarsToCents(11_200)
const rates: PriceLinkedRates = {
  commission: percentToBps(8),
  financingDealerFee: percentToBps(0),
  cardProcessing: percentToBps(0),
}

function factors(overrides: Partial<CloseFactors> = {}): CloseFactors {
  return {
    namedPreferred: false,
    competitorQuoteInHand: true,
    referralOrRepeat: false,
    financingRequested: false,
    insuranceClaim: false,
    hoursToProposal: 20,
    decisionDeadlineDays: null,
    ...overrides,
  }
}

describe('close estimate is a declared heuristic, not a model', () => {
  it('is stamped uncalibrated and carries a label', () => {
    const est = estimateClose(factors())
    expect(est.calibrated).toBe(false)
    expect(est.label).toContain('not a calibrated model')
  })

  it('shows every factor that moved it', () => {
    const est = estimateClose(factors({ namedPreferred: true, referralOrRepeat: true }))
    const names = est.contributions.map((c) => c.factor)
    expect(names).toContain('Named as preferred contractor')
    expect(names).toContain('Competing proposal in hand')
    expect(names).toContain('Proposal within 24 hours')
  })

  it('penalises a slow proposal and rewards a fast one', () => {
    const fast = estimateClose(factors({ hoursToProposal: 6 })).probability
    const slow = estimateClose(factors({ hoursToProposal: 96 })).probability
    expect(fast).toBeGreaterThan(slow)
  })

  it('stays inside sane bounds', () => {
    const everything = estimateClose(
      factors({
        namedPreferred: true,
        referralOrRepeat: true,
        financingRequested: true,
        insuranceClaim: true,
        competitorQuoteInHand: false,
        hoursToProposal: 1,
        decisionDeadlineDays: 2,
      }),
    )
    expect(everything.probability).toBeLessThanOrEqual(9000)
    expect(estimateClose(factors({ hoursToProposal: 400 })).probability).toBeGreaterThanOrEqual(500)
  })
})

describe('expected value compares options without choosing one', () => {
  it('computes probability x gross profit for each option', () => {
    const baselinePrice = dollarsToCents(18_050)
    const options = priceOptions(
      [
        { label: 'Hold', price: baselinePrice },
        { label: 'Partial match', price: dollarsToCents(17_230) },
        { label: 'Match', price: dollarsToCents(16_900) },
      ],
      JOB_COST,
      rates,
      estimateClose(factors()),
      baselinePrice,
      policy,
    )
    expect(options).toHaveLength(3)
    const hold = options[0]
    const match = options[2]
    expect(hold?.grossProfit).toBeGreaterThan(match?.grossProfit ?? 0)
    expect(match?.closeProbability).toBeGreaterThan(hold?.closeProbability ?? 0)
    for (const o of options) {
      expect(o.expectedGrossProfit).toBeLessThan(o.grossProfit)
    }
  })

  it('reports approval level per option instead of filtering them out', () => {
    const baselinePrice = dollarsToCents(18_050)
    const options = priceOptions(
      [
        { label: 'Hold', price: baselinePrice },
        { label: 'Deep cut', price: dollarsToCents(14_000) },
      ],
      JOB_COST,
      rates,
      estimateClose(factors()),
      baselinePrice,
      policy,
    )
    expect(options[0]?.approval.allowed).toBe(true)
    expect(options[1]?.approval.allowed).toBe(false)
  })
})

describe('strategy recommends, never selects', () => {
  const gap = analyseGap(ours, theirs, ourCost)

  it('asks for the unspecified items before anything about price', () => {
    const recs = recommendStrategy({
      gap,
      ourPrice: dollarsToCents(18_050),
      jobCost: JOB_COST,
      policy,
      financingOffered: false,
    })
    expect(recs[0]?.action).toBe('ask_competitor_to_specify')
  })

  it('puts explaining scope ahead of any discount', () => {
    const recs = recommendStrategy({
      gap,
      ourPrice: dollarsToCents(18_050),
      jobCost: JOB_COST,
      policy,
      financingOffered: true,
    })
    const explain = recs.findIndex((r) => r.action === 'hold_price_and_explain_scope')
    const discount = recs.findIndex(
      (r) => r.action === 'partial_match' || r.action === 'match_price',
    )
    expect(explain).toBeGreaterThanOrEqual(0)
    expect(explain).toBeLessThan(discount)
  })

  it('refuses to chase a bid that would break the floor', () => {
    const wide = analyseGap(
      normalisedScope('delta_ridge', 'DR', dollarsToCents(18_050), m([])),
      normalisedScope('competitor', 'C', dollarsToCents(13_000), m([])),
      () => null,
    )
    const recs = recommendStrategy({
      gap: wide,
      ourPrice: dollarsToCents(18_050),
      jobCost: JOB_COST,
      policy,
      financingOffered: false,
    })
    expect(recs.some((r) => r.action === 'do_not_chase')).toBe(true)
    expect(recs.some((r) => r.action === 'match_price')).toBe(false)
  })

  it('says there is nothing to compare when no competing total exists', () => {
    const recs = recommendStrategy({
      gap: null,
      ourPrice: dollarsToCents(18_050),
      jobCost: JOB_COST,
      policy,
      financingOffered: false,
    })
    expect(recs).toHaveLength(1)
    expect(recs[0]?.reason).toContain('nothing to compare')
  })
})
