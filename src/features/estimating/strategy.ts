import { BPS_SCALE, bps, cents, roundHalfUp, type Bps, type Cents } from './money'
import { authorisePrice, marginOf, type MarginPolicy } from './margin'
import { describePricing, type PriceLinkedRates } from './cost'
import type { GapAnalysis } from './normalise'

/**
 * Bid strategy: options with reasons, never an automatic choice.
 *
 * Two things this deliberately does not do.
 *
 * It does not invent a probability. The close estimate here is a declared
 * heuristic built from factors a human can read off the screen, and it is
 * stamped `calibrated: false` so nothing can present it as a model. Once
 * enough real Delta Ridge outcomes exist it can be replaced by something
 * fitted and measured; until then a confident-looking percentage would be
 * theatre.
 *
 * It does not pick the highest expected value and call that the answer. A
 * higher close rate at a lower margin is a real trade, but it is a trade about
 * the company's year, not about this kitchen table, and the rep makes it.
 */

export interface CloseFactors {
  /** The homeowner has said Delta Ridge is their preferred contractor. */
  readonly namedPreferred: boolean
  /** A competing proposal is actually in hand, not merely mentioned. */
  readonly competitorQuoteInHand: boolean
  readonly referralOrRepeat: boolean
  readonly financingRequested: boolean
  readonly insuranceClaim: boolean
  /** Hours from inspection to proposal. Speed is the factor that moves most. */
  readonly hoursToProposal: number
  readonly decisionDeadlineDays: number | null
}

export interface CloseEstimate {
  readonly probability: Bps
  readonly calibrated: false
  readonly contributions: readonly { readonly factor: string; readonly deltaBps: number }[]
  /** Must be shown wherever the probability is. */
  readonly label: string
}

const BASE_CLOSE_BPS = 3000

/**
 * A declared heuristic. The weights are guesses in the honest sense: they are
 * stated, visible and adjustable, and they are the first thing to replace with
 * fitted values once `project_actuals` has enough sold and lost jobs in it.
 */
export function estimateClose(factors: CloseFactors): CloseEstimate {
  const contributions: { factor: string; deltaBps: number }[] = []

  if (factors.namedPreferred) {
    contributions.push({ factor: 'Named as preferred contractor', deltaBps: 1500 })
  }
  if (factors.referralOrRepeat) {
    contributions.push({ factor: 'Referral or repeat customer', deltaBps: 1200 })
  }
  if (factors.competitorQuoteInHand) {
    contributions.push({ factor: 'Competing proposal in hand', deltaBps: -800 })
  }
  if (factors.financingRequested) {
    contributions.push({ factor: 'Financing requested', deltaBps: 500 })
  }
  if (factors.insuranceClaim) {
    contributions.push({ factor: 'Insurance claim in progress', deltaBps: 400 })
  }
  if (factors.hoursToProposal <= 24) {
    contributions.push({ factor: 'Proposal within 24 hours', deltaBps: 900 })
  } else if (factors.hoursToProposal > 72) {
    contributions.push({ factor: 'Proposal took more than 3 days', deltaBps: -1000 })
  }
  if (factors.decisionDeadlineDays !== null && factors.decisionDeadlineDays <= 7) {
    contributions.push({ factor: 'Decision expected within a week', deltaBps: 600 })
  }

  const raw = contributions.reduce((sum, c) => sum + c.deltaBps, BASE_CLOSE_BPS)
  return {
    probability: bps(Math.min(Math.max(raw, 500), 9000)),
    calibrated: false,
    contributions,
    label:
      'Deterministic estimate from stated factors, not a calibrated model. ' +
      'Treat it as a way to compare options, not as a forecast.',
  }
}

export interface PriceOption {
  readonly label: string
  readonly price: Cents
  readonly grossProfit: Cents
  readonly realisedMargin: Bps
  readonly closeProbability: Bps
  /** probability x gross profit. Comparable across options, not a forecast. */
  readonly expectedGrossProfit: Cents
  readonly approval: ReturnType<typeof authorisePrice>
}

/**
 * How much a discount is assumed to move the close rate.
 *
 * This is the weakest number in the whole model and it is isolated here on
 * purpose, with one job: make the trade visible. It is not evidence.
 */
export const CLOSE_LIFT_BPS_PER_MARGIN_POINT = 180

export function priceOptions(
  candidates: readonly { readonly label: string; readonly price: Cents }[],
  jobCost: Cents,
  rates: PriceLinkedRates,
  baseline: CloseEstimate,
  baselinePrice: Cents,
  policy: MarginPolicy,
): readonly PriceOption[] {
  const baselineMargin = marginOf(baselinePrice, jobCost)
  return candidates.map((candidate) => {
    const pricing = describePricing(candidate.price, jobCost, rates)
    const marginPoints = (baselineMargin - marginOf(candidate.price, jobCost)) / 100
    const lifted = baseline.probability + marginPoints * CLOSE_LIFT_BPS_PER_MARGIN_POINT
    const probability = bps(Math.min(Math.max(roundHalfUp(lifted), 500), 9500))
    return {
      label: candidate.label,
      price: candidate.price,
      grossProfit: pricing.grossProfit,
      realisedMargin: pricing.realisedMargin,
      closeProbability: probability,
      expectedGrossProfit: cents(
        roundHalfUp((pricing.grossProfit * probability) / BPS_SCALE),
      ),
      approval: authorisePrice(candidate.price, jobCost, policy),
    }
  })
}

export type StrategyAction =
  | 'hold_price_and_explain_scope'
  | 'ask_competitor_to_specify'
  | 'offer_alternate_package'
  | 'remove_optional_upgrade'
  | 'partial_match'
  | 'match_price'
  | 'add_financing'
  | 'do_not_chase'

export interface StrategyRecommendation {
  readonly action: StrategyAction
  readonly reason: string
  /** Where the rep can check the claim themselves. */
  readonly evidence: readonly string[]
}

/**
 * Recommendations, ordered, each with a reason. Nothing here selects a price.
 *
 * The ordering encodes an opinion worth stating plainly: explaining a
 * documented scope difference comes before any discount, and a competitor
 * being cheaper is not on its own a reason to bid lower.
 */
export function recommendStrategy(input: {
  readonly gap: GapAnalysis | null
  readonly ourPrice: Cents
  readonly jobCost: Cents
  readonly policy: MarginPolicy
  readonly financingOffered: boolean
}): readonly StrategyRecommendation[] {
  const out: StrategyRecommendation[] = []
  const { gap } = input

  if (gap === null) {
    out.push({
      action: 'hold_price_and_explain_scope',
      reason:
        'No competing total is on file, so there is nothing to compare. Present the scope.',
      evidence: [],
    })
    return out
  }

  if (gap.gap <= 0) {
    out.push({
      action: 'hold_price_and_explain_scope',
      reason: 'Delta Ridge is already at or below the competing total.',
      evidence: [`Gap ${gap.gap} cents`],
    })
    return out
  }

  if (gap.notSpecified.length > 0) {
    out.push({
      action: 'ask_competitor_to_specify',
      reason:
        `${gap.notSpecified.length} item(s) are not specified on one of the documents. ` +
        'Until they are, the two prices are not comparable and a discount would be guesswork.',
      evidence: gap.notSpecified.map((k) => `Not specified: ${k}`),
    })
  }

  if (gap.explained > 0) {
    out.push({
      action: 'hold_price_and_explain_scope',
      reason:
        `${gap.attributed.length} documented difference(s) account for part or all of the gap. ` +
        'Walk through them before discussing price.',
      evidence: gap.attributed.map((a) => `${a.label}: ${a.basis}`),
    })
  }

  // A discount is only ever suggested against the part of the gap that scope
  // does not already explain, and only within policy.
  if (gap.unexplained > 0) {
    const matched = cents(input.ourPrice - gap.unexplained)
    const verdict = authorisePrice(matched, input.jobCost, input.policy)

    out.push({
      action: 'remove_optional_upgrade',
      reason:
        'Closing the unexplained remainder by dropping an optional item keeps margin intact ' +
        'and keeps the comparison honest.',
      evidence: [],
    })

    if (input.financingOffered) {
      out.push({
        action: 'add_financing',
        reason:
          'A monthly figure often addresses the objection without moving the price. ' +
          'The dealer fee is already in the cost model, so the margin shown is the real one.',
        evidence: [],
      })
    }

    if (verdict.allowed) {
      out.push({
        action: verdict.level === 'rep' ? 'partial_match' : 'match_price',
        reason:
          verdict.level === 'rep'
            ? 'Matching the unexplained remainder stays inside the rep discount band.'
            : `Matching the unexplained remainder needs ${verdict.level} approval.`,
        evidence: [`Resulting margin ${(marginOf(matched, input.jobCost) / 100).toFixed(2)}%`],
      })
    } else {
      out.push({
        action: 'do_not_chase',
        reason: `Matching would break the margin floor: ${verdict.reason}.`,
        evidence: [],
      })
    }
  }

  return out
}
