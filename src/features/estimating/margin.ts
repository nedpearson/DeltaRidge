import {
  BPS_SCALE,
  bps,
  cents,
  roundHalfUp,
  subtractCents,
  type Bps,
  type Cents,
} from './money'

/**
 * Markup and margin are different numbers and conflating them is the single
 * most common way a roofing company quietly loses money.
 *
 *   cost $10,000 at 25% MARKUP  -> price $12,500, margin 20.00%
 *   cost $10,000 at 25% MARGIN  -> price $13,333.33, markup 33.33%
 *
 * Every function here names which one it means. Nothing in the estimator is
 * allowed to take a bare "25%" and guess.
 */

/** price = cost x (1 + markup) */
export function priceFromMarkup(cost: Cents, markup: Bps): Cents {
  if (markup < 0) throw new RangeError(`markup cannot be negative: ${markup}`)
  const product = cost * (BPS_SCALE + markup)
  return cents(roundHalfUp(product / BPS_SCALE))
}

/** price = cost / (1 - margin) */
export function priceFromMargin(cost: Cents, margin: Bps): Cents {
  if (margin < 0) throw new RangeError(`margin cannot be negative: ${margin}`)
  if (margin >= BPS_SCALE) {
    throw new RangeError(`margin must be below 100%; got ${margin} bps`)
  }
  const numerator = cost * BPS_SCALE
  return cents(roundHalfUp(numerator / (BPS_SCALE - margin)))
}

/** gross profit = price - cost */
export function grossProfit(price: Cents, cost: Cents): Cents {
  return subtractCents(price, cost)
}

/** margin = (price - cost) / price. Undefined at price 0. */
export function marginOf(price: Cents, cost: Cents): Bps {
  if (price === 0) throw new RangeError('margin is undefined at a zero price')
  return bps(roundHalfUp(((price - cost) * BPS_SCALE) / price))
}

/** markup = (price - cost) / cost. Undefined at cost 0. */
export function markupOf(price: Cents, cost: Cents): Bps {
  if (cost === 0) throw new RangeError('markup is undefined at a zero cost')
  return bps(roundHalfUp(((price - cost) * BPS_SCALE) / cost))
}

export interface MarginPolicy {
  /** The margin the company prices at by default. */
  readonly standardMargin: Bps
  /** What a rep may drop to without asking. */
  readonly targetMargin: Bps
  /** What a manager may approve. */
  readonly floorMargin: Bps
  /** Below this the job is declined. Nothing may authorise a lower price. */
  readonly stopMargin: Bps
}

export interface PriceLadder {
  readonly standard: Cents
  readonly target: Cents
  readonly floor: Cents
  readonly stop: Cents
}

/**
 * The four numbers a rep negotiates between, derived from one cost and a
 * policy. These are internal: none of them belongs on a customer proposal.
 */
export function priceLadder(cost: Cents, policy: MarginPolicy): PriceLadder {
  assertDescending(policy)
  return {
    standard: priceFromMargin(cost, policy.standardMargin),
    target: priceFromMargin(cost, policy.targetMargin),
    floor: priceFromMargin(cost, policy.floorMargin),
    stop: priceFromMargin(cost, policy.stopMargin),
  }
}

function assertDescending(policy: MarginPolicy): void {
  const { standardMargin, targetMargin, floorMargin, stopMargin } = policy
  if (standardMargin < targetMargin || targetMargin < floorMargin || floorMargin < stopMargin) {
    throw new RangeError(
      'margin policy must descend: standard >= target >= floor >= stop',
    )
  }
}

export type ApproverLevel = 'rep' | 'manager' | 'owner'

export type DiscountVerdict =
  | { readonly allowed: true; readonly level: ApproverLevel }
  | { readonly allowed: false; readonly reason: string }

/**
 * Who, if anyone, may authorise this price. Deliberately returns a verdict
 * rather than a boolean: the UI has to tell a rep whether to keep talking or
 * go get a manager.
 */
export function authorisePrice(
  price: Cents,
  cost: Cents,
  policy: MarginPolicy,
): DiscountVerdict {
  if (price <= 0) return { allowed: false, reason: 'price must be above zero' }
  const margin = marginOf(price, cost)
  if (margin >= policy.targetMargin) return { allowed: true, level: 'rep' }
  if (margin >= policy.floorMargin) return { allowed: true, level: 'manager' }
  if (margin >= policy.stopMargin) return { allowed: true, level: 'owner' }
  return {
    allowed: false,
    reason: `margin ${(margin / 100).toFixed(2)}% is below the stop margin of ${(
      policy.stopMargin / 100
    ).toFixed(2)}%`,
  }
}
