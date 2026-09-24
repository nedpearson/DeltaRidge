import { describe, expect, it } from 'vitest'
import { checkLanguage } from '@/features/claims/language'
import {
  assessReopen,
  policyOn,
  type NewEvidence,
  type PolicyPeriod,
  type PriorClaim,
} from '@/features/claims/reopen'

const PERIODS: PolicyPeriod[] = [
  { carrier: 'Carrier A', from: '2024-01-01', until: '2025-12-31' },
  { carrier: 'Carrier B', from: '2026-01-01', until: null },
]

const claim = (over: Partial<PriorClaim> = {}): PriorClaim => ({
  reportedDateOfLoss: '2026-03-31',
  carrier: 'Carrier B',
  closedAt: '2026-05-15',
  paidCents: 840_000,
  contractorScopeCents: 1_874_000,
  repairsCompleted: false,
  documentsOnFile: 4,
  ...over,
})

const evidence = (over: Partial<NewEvidence> = {}): NewEvidence => ({
  postClosureImagery: true,
  measurementReport: true,
  inspectionFindings: true,
  stormEvidence: true,
  ...over,
})

const NOW = '2026-09-23T00:00:00Z'

describe('policyOn', () => {
  it('finds the policy covering the reported date', () => {
    expect(policyOn(PERIODS, '2026-03-31')?.carrier).toBe('Carrier B')
    expect(policyOn(PERIODS, '2025-06-01')?.carrier).toBe('Carrier A')
  })

  it('treats an open-ended policy as still in force', () => {
    expect(policyOn(PERIODS, '2026-09-01')?.carrier).toBe('Carrier B')
  })

  it('returns null rather than the nearest policy when nothing covers the date', () => {
    /*
     * The most important assertion in this file. Returning "nearest" would
     * answer a question nobody asked, and is the first step toward moving a
     * date of loss to fit a policy.
     */
    expect(policyOn(PERIODS, '2023-06-01')).toBeNull()
  })
})

describe('a date of loss no policy covers', () => {
  const result = assessReopen(claim({ reportedDateOfLoss: '2023-06-01' }), PERIODS, evidence(), NOW)

  it('routes to somebody qualified rather than scoring it', () => {
    expect(result.basis).toBe('specialist_review')
  })

  it('says plainly that the date does not get changed to fit', () => {
    expect(result.sentence).toMatch(/does not get changed/i)
  })

  it('does not imply the current carrier covers a loss predating its policy', () => {
    expect(result.policyInForce).toBeNull()
    expect(result.sentence).not.toMatch(/Carrier B will/i)
  })
})

describe('a well-documented file', () => {
  const result = assessReopen(claim(), PERIODS, evidence(), NOW)

  it('says there is a basis to ask', () => {
    expect(result.basis).toBe('potential_review')
  })

  it('never promises the outcome', () => {
    expect(result.sentence).toMatch(/their decision/i)
    expect(result.sentence).not.toMatch(/\bwe will (get|win|reopen)\b/i)
    expect(checkLanguage(result.sentence).ok).toBe(true)
  })

  it('produces questions for the carrier, not assertions to it', () => {
    expect(result.questions.length).toBeGreaterThan(0)
    for (const question of result.questions) {
      expect(question.trim().endsWith('?')).toBe(true)
      // "Insurance owes this" is not a question.
      expect(question).not.toMatch(/\bowes?\b|\bmust pay\b/i)
    }
  })

  it('shows every check with its answer, for the drill-down', () => {
    expect(result.checks).toHaveLength(5)
    for (const check of result.checks) {
      expect(check.detail.length).toBeGreaterThan(5)
    }
  })
})

describe('a thin file', () => {
  it('says weak rather than dressing it up', () => {
    const result = assessReopen(
      claim({ paidCents: 1_900_000, contractorScopeCents: 1_800_000, closedAt: '2023-01-01' }),
      PERIODS,
      evidence({ postClosureImagery: false, measurementReport: false, inspectionFindings: false }),
      NOW,
    )
    expect(result.basis).toBe('weak_basis')
    expect(checkLanguage(result.sentence).ok).toBe(true)
  })
})

describe('repairs already done and nothing new', () => {
  it('says there is no basis, rather than finding one', () => {
    const result = assessReopen(
      claim({ repairsCompleted: true }),
      PERIODS,
      evidence({ postClosureImagery: false, measurementReport: false, inspectionFindings: false, stormEvidence: false }),
      NOW,
    )
    expect(result.basis).toBe('no_basis')
    expect(result.questions).toHaveLength(0)
  })
})

describe('every outcome survives the language guard', () => {
  it('holds across all four bases', () => {
    const cases = [
      assessReopen(claim(), PERIODS, evidence(), NOW),
      assessReopen(claim({ reportedDateOfLoss: '2023-06-01' }), PERIODS, evidence(), NOW),
      assessReopen(claim({ repairsCompleted: true }), PERIODS, evidence({ postClosureImagery: false, measurementReport: false, inspectionFindings: false, stormEvidence: false }), NOW),
      assessReopen(claim({ closedAt: '2022-01-01' }), PERIODS, evidence({ measurementReport: false }), NOW),
    ]
    const seen = new Set(cases.map((c) => c.basis))
    expect(seen.size).toBeGreaterThanOrEqual(3)
    for (const result of cases) {
      expect(checkLanguage(result.sentence).ok).toBe(true)
    }
  })
})
