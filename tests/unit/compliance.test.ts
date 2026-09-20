import { describe, expect, it } from 'vitest'
import {
  checkCompliance,
  documentationChecklist,
  incentivesFor,
  prohibitedConduct,
  rulesFor,
  statusOf,
  type ComplianceCheckInput,
  type Jurisdiction,
} from '@/features/compliance/engine'
import { ALL_LOUISIANA_RULES } from '@/features/compliance/louisiana'
import type { ComplianceRule } from '@/features/compliance/rules'

const TODAY = '2026-09-19'

const ebr: Jurisdiction = { state: 'LA', parish: 'East Baton Rouge', municipality: null }
const ascension: Jurisdiction = { state: 'LA', parish: 'Ascension', municipality: null }

function input(overrides: Partial<ComplianceCheckInput> = {}): ComplianceCheckInput {
  return {
    where: ebr,
    asOf: TODAY,
    projectValueCents: 1_865_000,
    paidFromInsuranceProceeds: false,
    heldLicenseClassifications: ['Residential Roofing'],
    licenseExpiresOn: '2027-06-30',
    ...overrides,
  }
}

const find = (rules: typeof ALL_LOUISIANA_RULES, id: string): ComplianceRule => {
  const r = rules.find((x) => x.id === id)
  if (!r) throw new Error(`fixture missing rule ${id}`)
  return r
}

describe('every rule is sourced or is explicitly a question', () => {
  it('has no rule that asserts a requirement without a source or a REQUIRES VERIFICATION note', () => {
    for (const rule of ALL_LOUISIANA_RULES) {
      if (rule.source === null) {
        expect(rule.notes ?? '').toContain('REQUIRES VERIFICATION')
      } else {
        expect(rule.source.url).toMatch(/^https:\/\//)
        expect(rule.source.citation.length).toBeGreaterThan(0)
        expect(rule.source.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      }
    }
  })

  it('treats an unsourced rule as unverified rather than as absent', () => {
    expect(statusOf(find(ALL_LOUISIANA_RULES, 'ebr-reroof-permit'), TODAY)).toBe(
      'requires_verification',
    )
  })

  it('goes review_due once the interval lapses, without becoming false', () => {
    const licence = find(ALL_LOUISIANA_RULES, 'la-license-residential-roofing')
    expect(statusOf(licence, TODAY)).toBe('verified')
    expect(statusOf(licence, '2027-04-01')).toBe('review_due')
  })
})

describe('licensing', () => {
  it('blocks a $7,500+ job when the classification is not held', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ heldLicenseClassifications: [] }),
    )
    const blocked = findings.find((f) => f.kind === 'blocked')
    expect(blocked?.ruleId).toBe('la-license-residential-roofing')
  })

  it('does not block below the threshold', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ projectValueCents: 740_000, heldLicenseClassifications: [] }),
    )
    expect(findings.some((f) => f.kind === 'blocked')).toBe(false)
  })

  it('blocks exactly at $7,500', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ projectValueCents: 750_000, heldLicenseClassifications: [] }),
    )
    expect(findings.some((f) => f.kind === 'blocked')).toBe(true)
  })

  it('blocks on an expired licence even when the classification is right', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ licenseExpiresOn: '2026-01-31' }),
    )
    expect(findings.some((f) => f.kind === 'blocked')).toBe(true)
  })

  it('does not apply before the effective date', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ asOf: '2025-12-31', heldLicenseClassifications: [] }),
    )
    expect(findings.some((f) => f.ruleId === 'la-license-residential-roofing')).toBe(false)
  })
})

describe('the deductible notice is inserted verbatim, never composed', () => {
  it('is required on an insurance-funded contract of $1,000 or more', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ paidFromInsuranceProceeds: true }),
    )
    const notice = findings.find((f) => f.kind === 'required_notice')
    expect(notice?.ruleId).toBe('la-contract-notice-deductible')
    if (notice?.kind === 'required_notice') {
      expect(notice.noticeText).toContain('Louisiana law requires a person insured')
      expect(notice.noticeText).toContain('applicable insurance deductible')
      expect(notice.formatting).toContain('12-point')
    }
  })

  it('is not required on a retail contract', () => {
    const findings = checkCompliance(ALL_LOUISIANA_RULES, input())
    expect(findings.some((f) => f.kind === 'required_notice')).toBe(false)
  })

  it('is not required below $1,000', () => {
    const findings = checkCompliance(
      ALL_LOUISIANA_RULES,
      input({ paidFromInsuranceProceeds: true, projectValueCents: 99_900 }),
    )
    expect(findings.some((f) => f.kind === 'required_notice')).toBe(false)
  })
})

describe('conduct the software may not perform', () => {
  it('names coverage interpretation and public adjusting', () => {
    const conduct = prohibitedConduct(ALL_LOUISIANA_RULES, ebr, TODAY)
    expect(conduct).toContain('interpret_policy_coverage')
    expect(conduct).toContain('act_as_public_adjuster')
    expect(conduct).toContain('authorise_repairs_without_itemised_estimate')
  })

  it('names every shape of deductible avoidance, not just the word waive', () => {
    const conduct = prohibitedConduct(ALL_LOUISIANA_RULES, ebr, TODAY)
    expect(conduct).toEqual(
      expect.arrayContaining([
        'waive_deductible',
        'absorb_deductible',
        'rebate_offsetting_deductible',
        'decline_to_collect_deductible',
      ]),
    )
  })
})

describe('FORTIFIED, without the implied promise', () => {
  it('reports the grant as unavailable in East Baton Rouge rather than hiding it', () => {
    const offers = incentivesFor(ALL_LOUISIANA_RULES, ebr, TODAY)
    const lfhp = offers.find((o) => o.ruleId === 'la-lfhp-grant')
    expect(lfhp).toBeDefined()
    expect(lfhp?.areaEligible).toBe(false)
  })

  it('reports it as available in Ascension', () => {
    const offers = incentivesFor(ALL_LOUISIANA_RULES, ascension, TODAY)
    expect(offers.find((o) => o.ruleId === 'la-lfhp-grant')?.areaEligible).toBe(true)
  })

  it('carries a qualifier that cannot be dropped', () => {
    const lfhp = incentivesFor(ALL_LOUISIANA_RULES, ascension, TODAY).find(
      (o) => o.ruleId === 'la-lfhp-grant',
    )
    expect(lfhp?.qualifier).toContain('not guaranteed')
    expect(lfhp?.qualifier).toContain('FORTIFIED Roof standard only')
  })

  it('does not surface the 2027 premium benchmarks before they take effect', () => {
    const now = incentivesFor(ALL_LOUISIANA_RULES, ebr, TODAY)
    expect(now.some((o) => o.ruleId === 'la-fortified-premium-benchmarks')).toBe(false)

    const later = incentivesFor(ALL_LOUISIANA_RULES, ebr, '2027-01-01')
    const benchmark = later.find((o) => o.ruleId === 'la-fortified-premium-benchmarks')
    expect(benchmark).toBeDefined()
    expect(benchmark?.qualifier).toContain('hurricane portion')
  })
})

describe('parish documentation', () => {
  it('produces the Ascension geo-tagged photo checklist', () => {
    const checklist = documentationChecklist(ALL_LOUISIANA_RULES, ascension, TODAY)
    expect(checklist.map((i) => i.key)).toEqual([
      'existing_roof_before',
      'removal_in_progress',
      'installation_in_progress',
      'completed_roof',
    ])
    expect(checklist.every((i) => i.requiresGeotag)).toBe(true)
  })

  it('does not apply Ascension documentation to an East Baton Rouge job', () => {
    expect(documentationChecklist(ALL_LOUISIANA_RULES, ebr, TODAY)).toEqual([])
  })

  it('surfaces the unverified EBR permit as a question, not as a fee', () => {
    const findings = checkCompliance(ALL_LOUISIANA_RULES, input())
    const check = findings.find(
      (f) => f.kind === 'needs_human_check' && f.ruleId === 'ebr-reroof-permit',
    )
    expect(check).toBeDefined()
    expect(findings.some((f) => f.kind === 'required_permit' && f.ruleId === 'ebr-reroof-permit')).toBe(
      false,
    )
  })

  it('says the fee is unknown rather than inventing one for the statewide permit', () => {
    const findings = checkCompliance(ALL_LOUISIANA_RULES, input())
    const permit = findings.find(
      (f) => f.kind === 'required_permit' && f.ruleId === 'la-permit-roofing-statewide',
    )
    expect(permit).toBeDefined()
    if (permit?.kind === 'required_permit') {
      expect(permit.feeCents).toBeNull()
      expect(permit.message).toContain('verify with the authority')
    }
  })
})

describe('ordering and scope', () => {
  it('ranks a statute above a secondary source', () => {
    const evaluated = rulesFor(ALL_LOUISIANA_RULES, ebr, TODAY)
    const statuteIndex = evaluated.findIndex((e) => e.rule.source?.tier === 'statute')
    const secondaryIndex = evaluated.findIndex((e) => e.rule.source?.tier === 'secondary')
    expect(statuteIndex).toBeLessThan(secondaryIndex)
  })

  it('does not leak one parish’s rules into another', () => {
    const ids = rulesFor(ALL_LOUISIANA_RULES, ebr, TODAY).map((e) => e.rule.id)
    expect(ids).not.toContain('ascension-reroof-photos')
    expect(ids).not.toContain('livingston-reroof-permit')
  })

  it('does not apply Louisiana rules to another state', () => {
    const texas: Jurisdiction = { state: 'TX', parish: 'Harris', municipality: 'Houston' }
    expect(rulesFor(ALL_LOUISIANA_RULES, texas, TODAY)).toEqual([])
  })
})
