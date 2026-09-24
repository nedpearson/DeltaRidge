/**
 * Comparing a carrier's estimate against what the roof actually measures.
 *
 * This is the most useful thing the software can do for a homeowner and the
 * easiest place to overreach, so the output vocabulary is fixed in advance: it
 * produces DIFFERENCES and QUESTIONS, never entitlements. "The carrier's
 * estimate uses 24 squares and the measurement report says 28.4" is a fact
 * anybody can check. "Insurance owes you four more squares" is a legal
 * conclusion about a policy this software has not read, and a contractor who
 * says it is practising adjusting without a licence — which in Louisiana, as in
 * most states, is a real offence with real penalties.
 *
 * ---------------------------------------------------------------------------
 * WHY A TOLERANCE, AND WHY IT IS NOT ZERO
 * ---------------------------------------------------------------------------
 *
 * Two people measuring the same roof will not agree exactly. Adjusters round to
 * the square, measurement reports carry their own error, waste factors differ
 * by pitch and by carrier convention, and a 2% disagreement is noise rather
 * than a finding. Flagging noise is how a gap analysis becomes something
 * adjusters learn to ignore — so the threshold below exists to keep the flags
 * few and therefore worth reading.
 */

export interface EstimateLine {
  /** As printed on the carrier's estimate. */
  readonly description: string
  readonly quantity: number
  /** 'SQ' squares, 'LF' linear feet, 'EA' each, 'SF' square feet. */
  readonly unit: string
  readonly unitPriceCents: number | null
  readonly totalCents: number | null
}

export interface CarrierEstimate {
  readonly carrier: string | null
  readonly claimNumber: string | null
  readonly lines: readonly EstimateLine[]
  readonly rcvCents: number | null
  readonly acvCents: number | null
  readonly deductibleCents: number | null
  /** Depreciation the homeowner recovers on completion. */
  readonly recoverableDepreciationCents: number | null
  readonly nonRecoverableDepreciationCents: number | null
}

/** What an independent measurement says the roof is. */
export interface MeasuredRoof {
  readonly squares: number | null
  readonly ridgeFeet: number | null
  readonly hipFeet: number | null
  readonly valleyFeet: number | null
  readonly eaveFeet: number | null
  readonly rakeFeet: number | null
  readonly source: string
}

/** Two measurements of one roof disagreeing by less than this is noise. */
export const MEASUREMENT_TOLERANCE = 0.02

export type DifferenceKind =
  | 'measurement_difference'
  | 'missing_item'
  | 'quantity_difference'

export interface Difference {
  readonly kind: DifferenceKind
  readonly label: string
  /** The two numbers, stated plainly, so a person can check the arithmetic. */
  readonly detail: string
  /** A question for the adjuster. Never an assertion of entitlement. */
  readonly question: string
}

/**
 * Line items a roof replacement normally contains.
 *
 * Deliberately short. A long list produces a long flag list, and a gap analysis
 * that flags twenty items is one an adjuster stops reading — so this covers
 * only items whose absence is genuinely worth a question, not every line a
 * contractor would like to be paid for.
 */
const EXPECTED: readonly { readonly key: string; readonly label: string; readonly match: RegExp }[] = [
  { key: 'starter', label: 'Starter course', match: /\bstarter\b/i },
  { key: 'ridge', label: 'Ridge cap', match: /\bridge\b.*\b(cap|shingle)\b|\bhip\s*(\/|and|&)?\s*ridge\b/i },
  { key: 'drip_edge', label: 'Drip edge', match: /\bdrip\s*edge\b/i },
  { key: 'underlayment', label: 'Underlayment', match: /\bunderlayment\b|\bfelt\b|\bsynthetic\b/i },
  { key: 'ice_water', label: 'Ice and water barrier', match: /\bice\s*(&|and)?\s*water\b/i },
  { key: 'pipe_boot', label: 'Pipe flashing', match: /\bpipe\s*(jack|boot|flash)/i },
  { key: 'ventilation', label: 'Ventilation', match: /\b(ridge\s*vent|turtle\s*vent|box\s*vent|turbine)\b/i },
]

function squaresIn(lines: readonly EstimateLine[]): number | null {
  // The roofing line is the one measured in squares, whatever it is called.
  const roofing = lines.filter(
    (line) => line.unit.toUpperCase() === 'SQ' && /shingle|roof|laminate|composition/i.test(line.description),
  )
  if (roofing.length === 0) return null
  return roofing.reduce((total, line) => total + line.quantity, 0)
}

/**
 * Linear feet of one roof feature, excluding lines that merely mention it.
 *
 * The exclusion is load-bearing. "Hip / Ridge cap" and "Ridge vent" both match
 * a naive /ridge/ and both are measured in linear feet along the same ridge, so
 * summing them double-counts — a correct estimate came back flagged as having
 * 136 ft of ridge where the roof measures 96. A gap analysis that fires on
 * correct estimates is one an adjuster stops reading, which costs more than the
 * feature is worth.
 */
function feetFor(lines: readonly EstimateLine[], match: RegExp, exclude?: RegExp): number | null {
  const found = lines.filter(
    (line) =>
      line.unit.toUpperCase() === 'LF' &&
      match.test(line.description) &&
      (exclude === undefined || !exclude.test(line.description)),
  )
  if (found.length === 0) return null
  return found.reduce((total, line) => total + line.quantity, 0)
}

/** Ventilation runs along the ridge and is priced separately from ridge cap. */
const VENTILATION = /\bvent\b|\bventilation\b|\bturbine\b|\bturtle\b|\bexhaust\b/i

function compareLength(
  label: string,
  estimated: number | null,
  measured: number | null,
  source: string,
): Difference | null {
  if (estimated === null || measured === null || measured === 0) return null
  const delta = measured - estimated
  if (Math.abs(delta) / measured <= MEASUREMENT_TOLERANCE) return null
  const more = delta > 0
  return {
    kind: 'measurement_difference',
    label,
    detail: `Estimate shows ${estimated} ft; ${source} measures ${measured} ft.`,
    // A question, always. The adjuster may have a good answer.
    question: more
      ? `The measurement report shows ${Math.round(delta)} ft more ${label.toLowerCase()} than the estimate. How was that length derived?`
      : `The estimate shows ${Math.round(-delta)} ft more ${label.toLowerCase()} than the measurement report. Which measurement is being used?`,
  }
}

export interface GapAnalysis {
  readonly differences: readonly Difference[]
  /** Every question, ready to be put to an adjuster. */
  readonly questions: readonly string[]
  /**
   * What the homeowner pays regardless, stated because it is the number they
   * most often misunderstand and the one no contractor may absorb.
   */
  readonly deductibleNote: string | null
  /** Said plainly, every time, because the rest of this is easy to misread. */
  readonly disclaimer: string
}

export function analyseGaps(estimate: CarrierEstimate, measured: MeasuredRoof): GapAnalysis {
  const differences: Difference[] = []

  const estimateSquares = squaresIn(estimate.lines)
  if (estimateSquares !== null && measured.squares !== null && measured.squares > 0) {
    const delta = measured.squares - estimateSquares
    if (Math.abs(delta) / measured.squares > MEASUREMENT_TOLERANCE) {
      differences.push({
        kind: 'measurement_difference',
        label: 'Roof area',
        detail: `Estimate shows ${estimateSquares} squares; ${measured.source} measures ${measured.squares}.`,
        question:
          delta > 0
            ? `The measurement report shows ${delta.toFixed(1)} squares more than the estimate. How was the estimate's roof area derived?`
            : `The estimate shows ${Math.abs(delta).toFixed(1)} squares more than the measurement report. Which figure is the adjuster working from?`,
      })
    }
  }

  const ridgeAndHip =
    measured.ridgeFeet === null && measured.hipFeet === null
      ? null
      : (measured.ridgeFeet ?? 0) + (measured.hipFeet ?? 0)

  const lengths: [string, number | null, RegExp, RegExp | undefined][] = [
    // Ridge cap only. Ridge VENT is ventilation and is counted nowhere here.
    ['Ridge and hip', ridgeAndHip, /\bridge\b|\bhip\b/i, VENTILATION],
    ['Valley', measured.valleyFeet, /\bvalley\b/i, undefined],
    ['Eave', measured.eaveFeet, /\beave\b|\bdrip\s*edge.*eave\b/i, undefined],
    ['Rake', measured.rakeFeet, /\brake\b/i, undefined],
  ]
  for (const [label, measuredFeet, pattern, exclude] of lengths) {
    const difference = compareLength(
      label,
      feetFor(estimate.lines, pattern, exclude),
      measuredFeet,
      measured.source,
    )
    if (difference !== null) differences.push(difference)
  }

  for (const item of EXPECTED) {
    const present = estimate.lines.some((line) => item.match.test(line.description))
    if (!present) {
      differences.push({
        kind: 'missing_item',
        label: item.label,
        detail: `No line on the estimate matches ${item.label.toLowerCase()}.`,
        // Not "they left it out". It may be inside another line, or excluded
        // for a reason the estimate does not print.
        question: `Is ${item.label.toLowerCase()} included in another line, or excluded — and if excluded, on what basis?`,
      })
    }
  }

  const deductibleNote =
    estimate.deductibleCents === null
      ? null
      : `The deductible of $${(estimate.deductibleCents / 100).toLocaleString('en-US')} is the homeowner's to pay. No contractor may absorb it.`

  return {
    differences,
    questions: differences.map((d) => d.question),
    deductibleNote,
    disclaimer:
      'These are differences between two documents, not a statement of what is owed. ' +
      'What a policy covers is the carrier’s determination.',
  }
}
