import { describe, expect, it } from 'vitest'
import { buildEstimate, componentsFor } from '@/features/estimating/build'
import { calculateWaste } from '@/features/estimating/waste'
import { DEFAULT_MARGINS, isUsable, missingCosts, type CostSheet } from '@/features/estimating/store'
import { marginOf } from '@/features/estimating/margin'
import { centsToDollars, percentToBps } from '@/features/estimating/money'
import type { RoofGeometry } from '@/features/estimating/geometry'

function geometry(overrides: Partial<RoofGeometry> = {}): RoofGeometry {
  return {
    facets: [
      { id: 'a', areaSqFt: 1_600, pitch: { rise: 6 } },
      { id: 'b', areaSqFt: 1_600, pitch: { rise: 6 } },
    ],
    ridgeLf: 40, hipLf: 0, valleyLf: 0, eaveLf: 80, rakeLf: 60,
    stepFlashingLf: 0, wallFlashingLf: 0,
    penetrations: [{ kind: 'pipe_boot', count: 3 }],
    stories: 1, eaveHeightFt: 10, existingLayers: 1, unknowns: [],
    ...overrides,
  }
}

/** Plausible numbers for a test only. Nothing like this ships in the app. */
const COSTS: CostSheet = {
  shingle_sq: 120, underlayment_sq: 18, starter_lf: 1.35, cap_lf: 2.6,
  drip_edge_lf: 1.15, valley_lf: 3.4, pipe_boot_ea: 14,
  tear_off_sq: 45, install_sq: 95, disposal_job: 650, permit_job: 150,
  steep_sq: 25, high_job: 400, decking_sheet: 95, ridge_vent_lf: 4.2,
}

describe('components come from the measurement', () => {
  it('drops anything that measures zero instead of pricing it at zero', () => {
    const g = geometry()
    const keys = componentsFor(g, calculateWaste(g)).map((c) => c.key)
    expect(keys).not.toContain('valley_lf')
    expect(keys).not.toContain('steep_sq')
    expect(keys).not.toContain('high_job')
  })

  it('includes them once the roof has them', () => {
    const g = geometry({
      valleyLf: 64, stories: 2,
      facets: [{ id: 'a', areaSqFt: 3_200, pitch: { rise: 10 } }],
    })
    const keys = componentsFor(g, calculateWaste(g)).map((c) => c.key)
    expect(keys).toEqual(expect.arrayContaining(['valley_lf', 'steep_sq', 'high_job']))
  })

  it('orders shingle with waste but underlayment without', () => {
    const g = geometry()
    const waste = calculateWaste(g)
    const built = componentsFor(g, waste)
    const shingle = built.find((c) => c.key === 'shingle_sq')
    const under = built.find((c) => c.key === 'underlayment_sq')
    expect(under?.quantity).toBe(32)
    expect(shingle?.quantity).toBeGreaterThan(32)
    expect(shingle?.quantity).toBeCloseTo(waste.orderAreaSqFt / 100, 6)
  })

  it('tears off once per existing layer', () => {
    const g = geometry({ existingLayers: 2 })
    const tearOff = componentsFor(g, calculateWaste(g)).find((c) => c.key === 'tear_off_sq')
    expect(tearOff?.quantity).toBe(64)
  })
})

describe('a missing cost is a gap, never a zero', () => {
  it('reports the gap and leaves the line off', () => {
    const withoutShingle: CostSheet = { ...COSTS }
    delete withoutShingle.shingle_sq
    const built = buildEstimate(geometry(), withoutShingle, DEFAULT_MARGINS)
    expect(built.gaps.map((g) => g.key)).toContain('shingle_sq')
    expect(built.lines.map((l) => l.id)).not.toContain('shingle_sq')
  })

  it('states the quantity that could not be priced', () => {
    const built = buildEstimate(geometry(), {}, DEFAULT_MARGINS)
    const gap = built.gaps.find((g) => g.key === 'install_sq')
    expect(gap?.quantity).toBe(32)
    expect(gap?.unit).toBe('SQ')
  })

  it('does not invent a price when nothing is entered', () => {
    const built = buildEstimate(geometry(), {}, DEFAULT_MARGINS)
    expect(built.lines).toHaveLength(0)
    expect(built.jobCost).toBe(0)
    expect(built.recommended.price).toBe(0)
    expect(built.ladder.standard).toBe(0)
  })
})

describe('a fully costed roof', () => {
  const built = buildEstimate(geometry(), COSTS, DEFAULT_MARGINS)

  it('prices every component with no gaps', () => {
    expect(built.gaps).toHaveLength(0)
    expect(built.lines.length).toBeGreaterThan(8)
  })

  it('carries overhead on top of direct cost', () => {
    expect(built.overhead).toBeGreaterThan(0)
    expect(built.jobCost).toBe(built.directCost + built.overhead)
  })

  it('leaves the standard margin AFTER commission', () => {
    expect(built.recommended.realisedMargin).toBe(percentToBps(38))
    expect(built.recommended.commission).toBeGreaterThan(0)
    // The naive price would not survive the commission.
    expect(built.recommended.price).toBeGreaterThan(built.ladder.standard)
  })

  it('produces a ladder that descends', () => {
    expect(built.ladder.standard).toBeGreaterThan(built.ladder.target)
    expect(built.ladder.target).toBeGreaterThan(built.ladder.floor)
    expect(built.ladder.floor).toBeGreaterThan(built.ladder.stop)
    expect(marginOf(built.ladder.stop, built.jobCost)).toBe(percentToBps(26))
  })

  it('lands in a believable range for a 32 SQ roof', () => {
    const dollars = centsToDollars(built.recommended.price)
    expect(dollars).toBeGreaterThan(10_000)
    expect(dollars).toBeLessThan(40_000)
  })

  it('every line says why it exists', () => {
    for (const line of built.lines) expect(line.reason).toBeTruthy()
  })
})

describe('cost sheet readiness', () => {
  it('is not usable while an essential cost is missing', () => {
    const partial: CostSheet = { ...COSTS }
    delete partial.install_sq
    expect(isUsable(partial)).toBe(false)
    expect(isUsable(COSTS)).toBe(true)
  })

  it('lists everything still unanswered', () => {
    expect(missingCosts({}).length).toBe(15)
    expect(missingCosts(COSTS)).toHaveLength(0)
  })

  it('treats zero as answered but not as usable', () => {
    expect(missingCosts({ ...COSTS, steep_sq: 0 })).toHaveLength(0)
    expect(isUsable({ ...COSTS, install_sq: 0 })).toBe(false)
  })
})
