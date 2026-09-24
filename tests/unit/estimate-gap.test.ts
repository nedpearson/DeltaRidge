import { describe, expect, it } from 'vitest'
import { checkLanguage } from '@/features/claims/language'
import {
  analyseGaps,
  MEASUREMENT_TOLERANCE,
  type CarrierEstimate,
  type EstimateLine,
  type MeasuredRoof,
} from '@/features/claims/estimate-gap'

const line = (description: string, quantity: number, unit: string): EstimateLine => ({
  description,
  quantity,
  unit,
  unitPriceCents: null,
  totalCents: null,
})

const complete: EstimateLine[] = [
  line('Laminated comp. shingle roofing - w/ felt', 28.4, 'SQ'),
  line('Starter course - universal', 140, 'LF'),
  line('Hip / Ridge cap - composition shingles', 96, 'LF'),
  line('Drip edge - eave', 140, 'LF'),
  line('Synthetic underlayment', 28.4, 'SQ'),
  line('Ice & water barrier', 6, 'SQ'),
  line('Pipe jack flashing', 3, 'EA'),
  line('Ridge vent - aluminium', 40, 'LF'),
  line('Valley metal', 32, 'LF'),
  line('Drip edge - rake', 88, 'LF'),
]

const estimate = (over: Partial<CarrierEstimate> = {}): CarrierEstimate => ({
  carrier: 'Carrier B',
  claimNumber: 'CLM-1',
  lines: complete,
  rcvCents: 1_874_000,
  acvCents: 1_420_000,
  deductibleCents: 250_000,
  recoverableDepreciationCents: 454_000,
  nonRecoverableDepreciationCents: null,
  ...over,
})

const measured: MeasuredRoof = {
  squares: 28.4,
  ridgeFeet: 56,
  hipFeet: 40,
  valleyFeet: 32,
  eaveFeet: 140,
  rakeFeet: 88,
  source: 'EagleView measurement report',
}

describe('a matching estimate', () => {
  it('raises nothing', () => {
    expect(analyseGaps(estimate(), measured).differences).toHaveLength(0)
  })

  it('does not flag disagreement inside tolerance', () => {
    // Two people measuring one roof will not agree exactly. Flagging noise is
    // how a gap analysis becomes something adjusters learn to ignore.
    const nearly = { ...measured, squares: 28.4 * (1 + MEASUREMENT_TOLERANCE * 0.9) }
    expect(analyseGaps(estimate(), nearly).differences).toHaveLength(0)
  })
})

describe('measurement differences', () => {
  it('finds a short roof area and asks how it was derived', () => {
    const short = estimate({
      lines: complete.map((l) => (l.unit === 'SQ' && /shingle/i.test(l.description) ? { ...l, quantity: 24 } : l)),
    })
    const result = analyseGaps(short, measured)
    const area = result.differences.find((d) => d.label === 'Roof area')
    expect(area?.kind).toBe('measurement_difference')
    expect(area?.detail).toContain('24 squares')
    expect(area?.detail).toContain('28.4')
    expect(area?.question).toMatch(/how was the estimate's roof area derived\?/i)
  })

  it('works the other way too, without assuming the estimate is wrong', () => {
    const generous = { ...measured, squares: 22 }
    const result = analyseGaps(estimate(), generous)
    const area = result.differences.find((d) => d.label === 'Roof area')
    expect(area?.question).toMatch(/which figure is the adjuster working from\?/i)
  })

  it('does not count a ridge vent as ridge cap', () => {
    /*
     * Both are linear feet along the same ridge, and a naive /ridge/ summed
     * them — flagging 136 ft of ridge on a roof that measures 96. A gap
     * analysis that fires on correct estimates is one an adjuster stops
     * reading.
     */
    const result = analyseGaps(estimate(), measured)
    expect(result.differences.some((d) => d.label === 'Ridge and hip')).toBe(false)
  })

  it('compares ridge and hip together, as an estimate prints them', () => {
    const shortRidge = estimate({
      lines: complete.map((l) => (/Hip \/ Ridge/i.test(l.description) ? { ...l, quantity: 60 } : l)),
    })
    const result = analyseGaps(shortRidge, measured)
    expect(result.differences.some((d) => d.label === 'Ridge and hip')).toBe(true)
  })
})

describe('missing items', () => {
  it('notices an absent starter course', () => {
    const without = estimate({ lines: complete.filter((l) => !/starter/i.test(l.description)) })
    const result = analyseGaps(without, measured)
    const missing = result.differences.find((d) => d.label === 'Starter course')
    expect(missing?.kind).toBe('missing_item')
  })

  it('asks whether it is included elsewhere rather than saying it was left out', () => {
    // It may be inside another line, or excluded for a reason the estimate
    // does not print. Neither is the contractor's call to make.
    const without = estimate({ lines: complete.filter((l) => !/drip edge/i.test(l.description)) })
    const result = analyseGaps(without, measured)
    const missing = result.differences.find((d) => d.label === 'Drip edge')
    expect(missing?.question).toMatch(/included in another line, or excluded/i)
  })

  it('does not flag an item written under a different name', () => {
    const felt = estimate({
      lines: complete.map((l) => (/synthetic underlayment/i.test(l.description) ? line('15# felt', 28.4, 'SQ') : l)),
    })
    expect(analyseGaps(felt, measured).differences.some((d) => d.label === 'Underlayment')).toBe(false)
  })
})

describe('the vocabulary it is allowed to use', () => {
  const broken = estimate({
    lines: [line('Laminated comp. shingle roofing', 20, 'SQ')],
  })
  const result = analyseGaps(broken, measured)

  it('produces questions, never entitlements', () => {
    expect(result.questions.length).toBeGreaterThan(0)
    for (const question of result.questions) {
      expect(question.trim().endsWith('?')).toBe(true)
      expect(question).not.toMatch(/\bowes?\b|\bmust pay\b|\bentitled\b|\bshould have paid\b/i)
    }
  })

  it('never says insurance owes anything, anywhere in the output', () => {
    const everything = [
      ...result.differences.map((d) => `${d.label} ${d.detail} ${d.question}`),
      result.disclaimer,
      result.deductibleNote ?? '',
    ].join(' ')
    expect(everything).not.toMatch(/\bowes?\b/i)
    expect(checkLanguage(everything).ok).toBe(true)
  })

  it('states plainly that these are document differences, not a determination', () => {
    expect(result.disclaimer).toMatch(/not a statement of what is owed/i)
    expect(result.disclaimer).toMatch(/carrier/i)
  })
})

describe('the deductible', () => {
  it('says whose it is, and that nobody may absorb it', () => {
    const note = analyseGaps(estimate(), measured).deductibleNote
    expect(note).toContain('$2,500')
    expect(note).toMatch(/homeowner's to pay/i)
    expect(note).toMatch(/no contractor may absorb it/i)
  })

  it('says nothing when the estimate does not state one', () => {
    expect(analyseGaps(estimate({ deductibleCents: null }), measured).deductibleNote).toBeNull()
  })
})

describe('missing inputs', () => {
  it('does not invent a roof-area difference when the measurement is absent', () => {
    const noMeasurement = { ...measured, squares: null }
    expect(
      analyseGaps(estimate(), noMeasurement).differences.some((d) => d.label === 'Roof area'),
    ).toBe(false)
  })

  it('does not flag a length the measurement report does not carry', () => {
    const noValley = { ...measured, valleyFeet: null }
    const withoutValley = estimate({ lines: complete.filter((l) => !/valley/i.test(l.description)) })
    expect(
      analyseGaps(withoutValley, noValley).differences.some((d) => d.label === 'Valley'),
    ).toBe(false)
  })
})
