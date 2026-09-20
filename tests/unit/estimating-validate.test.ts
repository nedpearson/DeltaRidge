import { describe, expect, it } from 'vitest'
import { canPresent, validateEstimate } from '@/features/estimating/validate'
import { dollarsToCents, percentToBps } from '@/features/estimating/money'
import { priceFromMargin, type MarginPolicy } from '@/features/estimating/margin'
import type { EstimateLine, EstimateVersion } from '@/features/estimating/estimate'
import type { InspectionFacts } from '@/features/estimating/scope'
import type { RoofGeometry } from '@/features/estimating/geometry'

const policy: MarginPolicy = {
  standardMargin: percentToBps(38),
  targetMargin: percentToBps(35),
  floorMargin: percentToBps(30),
  stopMargin: percentToBps(26),
}

const JOB_COST = dollarsToCents(12_100)

function geometry(overrides: Partial<RoofGeometry> = {}): RoofGeometry {
  return {
    facets: [{ id: 'a', areaSqFt: 3_200, pitch: { rise: 6 } }],
    ridgeLf: 40,
    hipLf: 0,
    valleyLf: 0,
    eaveLf: 80,
    rakeLf: 60,
    stepFlashingLf: 0,
    wallFlashingLf: 0,
    penetrations: [],
    stories: 1,
    eaveHeightFt: 10,
    existingLayers: 1,
    unknowns: [],
    ...overrides,
  }
}

function line(overrides: Partial<EstimateLine> = {}): EstimateLine {
  return {
    id: 'l1',
    sortOrder: 0,
    category: 'material',
    description: 'Architectural shingle',
    quantity: 35,
    unit: 'SQ',
    cost: dollarsToCents(4_200),
    reason: 'delta_ridge_standard',
    evidence: [],
    optional: false,
    materialItemId: null,
    laborItemId: null,
    ...overrides,
  }
}

function version(lines: readonly EstimateLine[]): EstimateVersion {
  return {
    id: 'e1:v1',
    estimateId: 'e1',
    versionNumber: 1,
    mode: 'retail',
    lines,
    provenance: {
      priceBookVersion: '2026.09',
      pricedAsOf: '2026-09-19',
      wasteModelVersion: 'v1',
      marginPolicyVersion: 'v1',
      geometrySource: 'manual',
      jurisdictionRuleVersion: null,
    },
    createdAt: '2026-09-19T00:00:00Z',
    createdBy: 'ned',
  }
}

function facts(overrides: Partial<InspectionFacts> = {}): InspectionFacts {
  return {
    geometry: geometry(),
    observations: [],
    photoCategories: [],
    homeownerStatedRoofAgeYears: null,
    ...overrides,
  }
}

const complete: readonly EstimateLine[] = [
  line(),
  line({ id: 'l2', description: 'Drip edge', quantity: 140, unit: 'LF' }),
  line({ id: 'l3', description: 'Hip and ridge cap', quantity: 40, unit: 'LF' }),
]

function run(
  lines: readonly EstimateLine[],
  f: InspectionFacts = facts(),
  price = priceFromMargin(JOB_COST, percentToBps(38)),
) {
  return validateEstimate({
    version: version(lines),
    facts: f,
    sellPrice: price,
    jobCost: JOB_COST,
    marginPolicy: policy,
  })
}

const codes = (flags: readonly { code: string }[]) => flags.map((f) => f.code)

describe('estimate validation', () => {
  it('passes a complete estimate priced at standard', () => {
    const flags = run(complete)
    expect(codes(flags)).toEqual([])
    expect(canPresent(flags)).toBe(true)
  })

  it('catches measured scope that nothing on the estimate covers', () => {
    const flags = run([line()], facts({ geometry: geometry({ valleyLf: 64 }) }))
    expect(codes(flags)).toContain('valley_unpriced')
    expect(codes(flags)).toContain('drip_edge_unpriced')
    expect(codes(flags)).toContain('cap_unpriced')
  })

  it('names the quantity rather than saying "review your estimate"', () => {
    const flags = run([line()], facts({ geometry: geometry({ valleyLf: 64 }) }))
    const valley = flags.find((f) => f.code === 'valley_unpriced')
    expect(valley?.message).toContain('64 LF')
    expect(valley?.target).toEqual({ kind: 'scope', suggestionKey: 'valley_unpriced' })
  })

  it('blocks on low-slope area with no low-slope system', () => {
    const flags = run(
      complete,
      facts({
        geometry: geometry({
          facets: [
            { id: 'a', areaSqFt: 3_000, pitch: { rise: 6 } },
            { id: 'porch', areaSqFt: 200, pitch: { rise: 1 } },
          ],
        }),
      }),
    )
    expect(codes(flags)).toContain('low_slope_unpriced')
    expect(canPresent(flags)).toBe(false)
  })

  it('catches what was photographed and then not priced', () => {
    const flags = run(
      complete,
      facts({
        photoCategories: [
          { id: 'p1', category: 'pipe_boot' },
          { id: 'p2', category: 'pipe_boot' },
        ],
      }),
    )
    const boots = flags.find((f) => f.code === 'pipe_boots_unpriced')
    expect(boots?.message).toContain('You documented 2 pipe boots')
  })

  it('catches a short count against the measurement', () => {
    const flags = run(
      [...complete, line({ id: 'l4', description: 'Pipe boot', quantity: 1, unit: 'EA' })],
      facts({ geometry: geometry({ penetrations: [{ kind: 'pipe_boot', count: 3 }] }) }),
    )
    expect(codes(flags)).toContain('pipe_boots_unpriced_short')
  })

  it('blocks a code claim with nothing cited', () => {
    const flags = run([
      ...complete,
      line({ id: 'l5', description: 'Ice and water barrier', reason: 'code_required' }),
    ])
    const flag = flags.find((f) => f.code === 'code_claim_uncited')
    expect(flag?.severity).toBe('blocker')
    expect(canPresent(flags)).toBe(false)
  })

  it('accepts a code claim that carries a citation', () => {
    const flags = run([
      ...complete,
      line({
        id: 'l5',
        description: 'Ice and water barrier',
        reason: 'code_required',
        evidence: [
          { kind: 'code_citation', referenceId: 'r1', summary: 'Adopted code reference' },
        ],
      }),
    ])
    expect(codes(flags)).not.toContain('code_claim_uncited')
  })

  it('treats an unmeasured field as unknown, not as zero', () => {
    const flags = run(complete, facts({ geometry: geometry({ unknowns: ['valleyLf'] }) }))
    const flag = flags.find((f) => f.code === 'geometry_unknown')
    expect(flag?.severity).toBe('blocker')
    expect(flag?.message).toContain('invented')
  })

  it('spots a line billed twice', () => {
    const flags = run([...complete, line({ id: 'l9', description: 'Drip edge', unit: 'LF' })])
    expect(codes(flags)).toContain('duplicate_line')
  })

  it('blocks a price below the stop margin and allows one that needs approval', () => {
    const tooLow = run(complete, facts(), dollarsToCents(15_000))
    expect(codes(tooLow)).toContain('below_stop_price')
    expect(canPresent(tooLow)).toBe(false)

    const needsManager = run(complete, facts(), priceFromMargin(JOB_COST, percentToBps(31)))
    expect(codes(needsManager)).toContain('needs_approval')
    expect(canPresent(needsManager)).toBe(true)
  })

  it('blocks an estimate with no price at all', () => {
    const flags = run(complete, facts(), null)
    expect(codes(flags)).toContain('no_price')
  })

  it('sorts blockers ahead of warnings', () => {
    const flags = run(
      [line({ reason: 'code_required' })],
      facts({ geometry: geometry({ valleyLf: 64, unknowns: ['hipLf'] }) }),
    )
    const severities = flags.map((f) => f.severity)
    expect(severities).toEqual([...severities].sort())
    expect(severities[0]).toBe('blocker')
  })
})
