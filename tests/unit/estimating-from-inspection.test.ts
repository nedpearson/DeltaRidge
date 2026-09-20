import { describe, expect, it } from 'vitest'
import { factsFrom, observationFacts, seedFrom } from '@/features/estimating/from-inspection'
import { suggestScope } from '@/features/estimating/scope'
import type { LocalInspection, LocalObservation, LocalPhoto } from '@/lib/db'
import type { RoofGeometry } from '@/features/estimating/geometry'

const GEOMETRY: RoofGeometry = {
  facets: [{ id: 'a', areaSqFt: 3_200, pitch: { rise: 6 } }],
  ridgeLf: 40, hipLf: 0, valleyLf: 0, eaveLf: 80, rakeLf: 60,
  stepFlashingLf: 0, wallFlashingLf: 0, penetrations: [],
  stories: 1, eaveHeightFt: 10, existingLayers: 1, unknowns: [],
}

function inspection(overrides: Partial<LocalInspection> = {}): LocalInspection {
  return {
    id: 'i1', createdAt: '2026-09-20T00:00:00Z', updatedAt: '2026-09-20T00:00:00Z',
    status: 'in_progress', propertyType: 'residential', roofMaterial: 'architectural_shingle',
    syncState: 'local', ...overrides,
  }
}

function observation(overrides: Partial<LocalObservation> = {}): LocalObservation {
  return {
    id: 'o1', inspectionId: 'i1', finding: 'Soft decking near the rear valley',
    severity: 'moderate', source: 'inspector', createdAt: '2026-09-20T00:00:00Z',
    syncState: 'local', ...overrides,
  }
}

function photo(overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    id: 'p1', inspectionId: 'i1', category: 'pipe_boot',
    blob: new Blob(), thumbnail: new Blob(), width: 100, height: 100, byteSize: 10,
    capturedAt: '2026-09-20T00:00:00Z', retakeRecommended: false, syncState: 'local',
    ...overrides,
  }
}

describe('confirmation is carried across, never assumed', () => {
  it('marks an observation with no confirmedAt as unconfirmed', () => {
    const facts = observationFacts([observation()])
    expect(facts[0]?.confirmed).toBe(false)
  })

  it('marks one with a confirmedAt as confirmed', () => {
    const facts = observationFacts([observation({ confirmedAt: '2026-09-20T01:00:00Z' })])
    expect(facts[0]?.confirmed).toBe(true)
  })

  /**
   * The load-bearing one. If this mapping ever defaults confirmed to true, an
   * unreviewed voice note silently becomes scope on a customer estimate.
   */
  it('keeps an unconfirmed finding out of the suggestions', () => {
    const unconfirmed = suggestScope(
      factsFrom(inspection(), [], [observation()], GEOMETRY),
    )
    expect(unconfirmed.map((s) => s.key)).not.toContain('decking_allowance')

    const confirmed = suggestScope(
      factsFrom(inspection(), [], [observation({ confirmedAt: '2026-09-20T01:00:00Z' })], GEOMETRY),
    )
    expect(confirmed.map((s) => s.key)).toContain('decking_allowance')
  })
})

describe('facts come from what was recorded', () => {
  it('passes photo categories through for the scope rules', () => {
    const facts = factsFrom(inspection(), [photo(), photo({ id: 'p2' })], [], GEOMETRY)
    expect(facts.photoCategories).toHaveLength(2)
    const suggestions = suggestScope(facts)
    const boots = suggestions.find((s) => s.key === 'pipe_boot_replacement')
    expect(boots?.quantity).toBe(2)
    expect(boots?.needsQuantity).toBe(true)
  })

  it('carries the homeowner-stated roof age', () => {
    const facts = factsFrom(
      inspection({ homeownerStatedRoofAgeYears: 14 }), [], [], GEOMETRY,
    )
    expect(facts.homeownerStatedRoofAgeYears).toBe(14)
  })

  it('tolerates a missing inspection', () => {
    const facts = factsFrom(null, [], [], GEOMETRY)
    expect(facts.homeownerStatedRoofAgeYears).toBeNull()
  })
})

describe('the measurement seed does not invent measurements', () => {
  it('seeds nothing when the inspection knows nothing', () => {
    expect(seedFrom(inspection(), [])).toEqual({})
  })

  it('seeds storeys only when recorded', () => {
    expect(seedFrom(inspection({ stories: 2 }), []).stories).toBe('2')
    expect(seedFrom(inspection(), []).stories).toBeUndefined()
  })

  it('seeds a boot count from photos as a starting number', () => {
    const seed = seedFrom(inspection(), [photo(), photo({ id: 'p2' })])
    expect(seed.pipeBoots).toBe('2')
  })

  it('does not seed boots from unrelated photos', () => {
    expect(seedFrom(inspection(), [photo({ category: 'gutter' })]).pipeBoots).toBeUndefined()
  })
})
