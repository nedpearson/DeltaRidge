import {
  BPS_SCALE,
  addCents,
  applyBps,
  bps,
  cents,
  roundHalfUp,
  sumCents,
  ZERO_CENTS,
  type Bps,
  type Cents,
} from './money'

/**
 * The true cost of doing the job, built from parts rather than from a
 * $-per-square habit.
 *
 * The important distinction, and the one most estimating tools get wrong:
 * some costs are fixed by the job and some are a percentage of whatever
 * Delta Ridge ends up charging. Commission, financing dealer fees and card
 * processing all move when the price moves, so treating them as fixed costs
 * and then adding margin on top understates them at every price except the
 * one they were computed at.
 */

export type JobCostCategory =
  | 'material'
  | 'labor'
  | 'equipment'
  | 'subcontract'
  | 'permit'
  | 'disposal'
  | 'delivery'
  | 'fuel'
  | 'access'
  | 'safety'
  | 'warranty_reserve'
  | 'contingency'
  | 'overhead'

export interface JobCostLine {
  readonly category: JobCostCategory
  readonly description: string
  readonly amount: Cents
}

/** Costs that are a share of the selling price, not of the job. */
export interface PriceLinkedRates {
  readonly commission: Bps
  readonly financingDealerFee: Bps
  readonly cardProcessing: Bps
}

export const NO_PRICE_LINKED_RATES: PriceLinkedRates = {
  commission: bps(0),
  financingDealerFee: bps(0),
  cardProcessing: bps(0),
}

export function totalPriceLinkedRate(rates: PriceLinkedRates): Bps {
  return bps(rates.commission + rates.financingDealerFee + rates.cardProcessing)
}

export interface OverheadPolicy {
  /** Overhead recovered as a share of direct job cost. */
  readonly rate: Bps
  /** A floor, so a tiny repair still carries its share of the truck. */
  readonly minimum: Cents
}

export interface JobCost {
  readonly lines: readonly JobCostLine[]
  readonly directCost: Cents
  readonly overhead: Cents
  /** Everything that does not move when the price moves. */
  readonly total: Cents
}

const DIRECT_CATEGORIES: readonly JobCostCategory[] = [
  'material',
  'labor',
  'equipment',
  'subcontract',
  'permit',
  'disposal',
  'delivery',
  'fuel',
  'access',
  'safety',
  'warranty_reserve',
  'contingency',
]

export function buildJobCost(
  lines: readonly JobCostLine[],
  overheadPolicy: OverheadPolicy,
): JobCost {
  const directCost = sumCents(
    lines.filter((l) => DIRECT_CATEGORIES.includes(l.category)).map((l) => l.amount),
  )
  // The minimum exists so a small repair still carries its share of the truck.
  // It must not apply when there is no job at all: an estimate with nothing
  // priced would otherwise show $250 of overhead and a confident selling price
  // built on top of it.
  const computed = applyBps(directCost, overheadPolicy.rate)
  const overhead =
    directCost === 0 ? ZERO_CENTS : cents(Math.max(computed, overheadPolicy.minimum))
  return {
    lines,
    directCost,
    overhead,
    total: addCents(directCost, overhead),
  }
}

export interface PricingSolution {
  readonly price: Cents
  readonly jobCost: Cents
  readonly commission: Cents
  readonly financingDealerFee: Cents
  readonly cardProcessing: Cents
  /** Job cost plus every price-linked cost at this price. */
  readonly totalCost: Cents
  readonly grossProfit: Cents
  readonly realisedMargin: Bps
}

/**
 * Solve for the price that leaves `targetMargin` AFTER the price-linked costs.
 *
 *   price - jobCost - price x r = price x m
 *   price (1 - r - m) = jobCost
 *   price = jobCost / (1 - r - m)
 *
 * Pricing at jobCost/(1-m) and paying commission out of the result is the
 * quiet version of the same mistake: on a $18,000 job at 8% commission it
 * loses about $1,440 of the margin that was supposed to be there.
 */
export function solvePrice(
  jobCost: Cents,
  targetMargin: Bps,
  rates: PriceLinkedRates,
): PricingSolution {
  const r = totalPriceLinkedRate(rates)
  const denominator = BPS_SCALE - r - targetMargin
  if (denominator <= 0) {
    throw new RangeError(
      `margin ${targetMargin} bps plus price-linked costs ${r} bps leaves nothing to price against`,
    )
  }
  const price = cents(roundHalfUp((jobCost * BPS_SCALE) / denominator))
  return describePricing(price, jobCost, rates)
}

/** What a given price actually yields, once the price-linked costs are paid. */
export function describePricing(
  price: Cents,
  jobCost: Cents,
  rates: PriceLinkedRates,
): PricingSolution {
  const commission = applyBps(price, rates.commission)
  const financingDealerFee = applyBps(price, rates.financingDealerFee)
  const cardProcessing = applyBps(price, rates.cardProcessing)
  const totalCost = addCents(jobCost, commission, financingDealerFee, cardProcessing)
  const profit = cents(price - totalCost)
  return {
    price,
    jobCost,
    commission,
    financingDealerFee,
    cardProcessing,
    totalCost,
    grossProfit: profit,
    realisedMargin: price === 0 ? bps(0) : bps(roundHalfUp((profit * BPS_SCALE) / price)),
  }
}

export const ZERO_JOB_COST: JobCost = {
  lines: [],
  directCost: ZERO_CENTS,
  overhead: ZERO_CENTS,
  total: ZERO_CENTS,
}
