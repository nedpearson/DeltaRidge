import { describe, expect, it } from 'vitest'
import {
  applyWasteOverride,
  calculateWaste,
  DEFAULT_WASTE_MODEL,
} from '@/features/estimating/waste'
import {
  lowSlopeAreaSqFt,
  predominantPitch,
  slopeFactor,
  totalSquares,
  countPenetrations,
  type RoofGeometry,
} from '@/features/estimating/geometry'

function geometry(overrides: Partial<RoofGeometry> = {}): RoofGeometry {
  return {
    facets: [
      { id: 'a', areaSqFt: 1_600, pitch: { rise: 6 } },
      { id: 'b', areaSqFt: 1_600, pitch: { rise: 6 } },
    ],
    ridgeLf: 40,
    hipLf: 0,
    valleyLf: 0,
    eaveLf: 80,
    rakeLf: 60,
    stepFlashingLf: 0,
    wallFlashingLf: 0,
    penetrations: [{ kind: 'pipe_boot', count: 3 }],
    stories: 1,
    eaveHeightFt: 10,
    existingLayers: 1,
    unknowns: [],
    ...overrides,
  }
}

describe('geometry', () => {
  it('reports squares and slope factor', () => {
    expect(totalSquares(geometry())).toBe(32)
    expect(slopeFactor({ rise: 8 })).toBeCloseTo(1.2019, 4)
    expect(slopeFactor({ rise: 0 })).toBe(1)
  })

  it('area-weights the predominant pitch', () => {
    const mixed = geometry({
      facets: [
        { id: 'a', areaSqFt: 3_000, pitch: { rise: 4 } },
        { id: 'b', areaSqFt: 1_000, pitch: { rise: 12 } },
      ],
    })
    expect(predominantPitch(mixed).rise).toBe(6)
  })

  it('separates low-slope area a shingle cannot cover', () => {
    const withFlat = geometry({
      facets: [
        { id: 'a', areaSqFt: 2_800, pitch: { rise: 6 } },
        { id: 'porch', areaSqFt: 240, pitch: { rise: 1 } },
      ],
    })
    expect(lowSlopeAreaSqFt(withFlat)).toBe(240)
  })

  it('counts penetrations by kind', () => {
    expect(countPenetrations(geometry(), 'pipe_boot')).toBe(3)
    expect(countPenetrations(geometry(), 'skylight')).toBe(0)
  })
})

describe('waste is derived from geometry', () => {
  it('gives a simple gable the floor, not a habitual 10%', () => {
    const result = calculateWaste(geometry())
    expect(result.wasteBps).toBeLessThan(600)
    expect(result.orderAreaSqFt).toBeGreaterThan(result.fieldAreaSqFt)
  })

  it('charges a cut-up hip roof more than a gable of the same area', () => {
    const gable = calculateWaste(geometry())
    const cutUp = calculateWaste(
      geometry({ hipLf: 180, valleyLf: 120, rakeLf: 20, ridgeLf: 30 }),
    )
    expect(cutUp.wasteBps).toBeGreaterThan(gable.wasteBps)
  })

  it('adds a surcharge only to steep facets', () => {
    const flatter = calculateWaste(geometry())
    const steep = calculateWaste(
      geometry({
        facets: [
          { id: 'a', areaSqFt: 1_600, pitch: { rise: 10 } },
          { id: 'b', areaSqFt: 1_600, pitch: { rise: 10 } },
        ],
      }),
    )
    expect(steep.wasteBps).toBeGreaterThan(flatter.wasteBps)
  })

  it('clamps an absurd geometry and says that it did', () => {
    const absurd = calculateWaste(geometry({ hipLf: 4_000, valleyLf: 4_000 }))
    expect(absurd.wasteBps).toBe(DEFAULT_WASTE_MODEL.maxBps)
    expect(absurd.clamped).toBe(true)
  })

  it('explains every component', () => {
    const result = calculateWaste(geometry({ hipLf: 60, valleyLf: 40 }))
    expect(result.components).toHaveLength(4)
    for (const component of result.components) {
      expect(component.explanation.length).toBeGreaterThan(0)
    }
    const hipValley = result.components.find((c) => c.source === 'hips_valleys')
    expect(hipValley?.wasteSqFt).toBeCloseTo(100 * 0.75, 6)
  })

  it('handles a zero-area roof without dividing by zero', () => {
    const empty = calculateWaste(geometry({ facets: [] }))
    expect(empty.wasteBps).toBe(0)
    expect(empty.orderAreaSqFt).toBe(0)
  })
})

describe('waste overrides are recorded, never silent', () => {
  it('requires a reason', () => {
    const result = calculateWaste(geometry())
    expect(() =>
      applyWasteOverride(result, { wasteBps: 1_500, reason: '  ', overriddenBy: 'ned' }),
    ).toThrow()
  })

  it('keeps the calculated components alongside the override', () => {
    const result = calculateWaste(geometry())
    const applied = applyWasteOverride(result, {
      wasteBps: 1_200,
      reason: 'Two dormers not in the measurement report',
      overriddenBy: 'ned',
    })
    expect(applied.wasteBps).toBe(1_200)
    expect(applied.components).toEqual(result.components)
    expect(applied.override?.reason).toContain('dormers')
  })
})
