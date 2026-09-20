import { describe, expect, it } from 'vitest'
import { suggestScope, type InspectionFacts } from '@/features/estimating/scope'
import { expandAssembly, type Assembly } from '@/features/estimating/assemblies'
import { calculateWaste } from '@/features/estimating/waste'
import type { RoofGeometry } from '@/features/estimating/geometry'

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
    penetrations: [],
    stories: 1,
    eaveHeightFt: 10,
    existingLayers: 1,
    unknowns: [],
    ...overrides,
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

const keys = (s: readonly { key: string }[]) => s.map((x) => x.key)

describe('scope suggestions from the inspection', () => {
  it('suggests nothing conditional on a plain single-layer gable', () => {
    expect(keys(suggestScope(facts()))).toEqual([])
  })

  it('catches a second layer from the measurement', () => {
    const s = suggestScope(facts({ geometry: geometry({ existingLayers: 2 }) }))
    const tearOff = s.find((x) => x.key === 'tear_off_additional_layer')
    expect(tearOff?.quantity).toBe(32)
    expect(tearOff?.confidence).toBe('high')
    expect(tearOff?.needsQuantity).toBe(false)
  })

  it('flags area a shingle is not approved for', () => {
    const s = suggestScope(
      facts({
        geometry: geometry({
          facets: [
            { id: 'a', areaSqFt: 2_800, pitch: { rise: 6 } },
            { id: 'porch', areaSqFt: 240, pitch: { rise: 1 } },
          ],
        }),
      }),
    )
    const low = s.find((x) => x.key === 'low_slope_system')
    expect(low?.quantity).toBe(240)
    expect(low?.rationale).toContain('Confirm the applicable requirement')
  })

  it('counts boots from the measurement when it has them', () => {
    const s = suggestScope(
      facts({ geometry: geometry({ penetrations: [{ kind: 'pipe_boot', count: 3 }] }) }),
    )
    const boots = s.find((x) => x.key === 'pipe_boot_replacement')
    expect(boots?.quantity).toBe(3)
    expect(boots?.confidence).toBe('high')
    expect(boots?.needsQuantity).toBe(false)
  })

  it('falls back to photos but asks for the count', () => {
    const s = suggestScope(
      facts({
        photoCategories: [
          { id: 'p1', category: 'pipe_boot' },
          { id: 'p2', category: 'pipe_boot' },
        ],
      }),
    )
    const boots = s.find((x) => x.key === 'pipe_boot_replacement')
    expect(boots?.quantity).toBe(2)
    expect(boots?.confidence).toBe('medium')
    expect(boots?.needsQuantity).toBe(true)
    expect(boots?.evidence.every((e) => e.kind === 'photo')).toBe(true)
  })

  it('ignores an unconfirmed finding entirely', () => {
    const unconfirmed = suggestScope(
      facts({
        observations: [
          {
            id: 'o1',
            component: 'decking',
            finding: 'Soft decking near the rear valley',
            severity: 'moderate',
            confirmed: false,
          },
        ],
      }),
    )
    expect(keys(unconfirmed)).not.toContain('decking_allowance')
  })

  it('turns a confirmed decking finding into an allowance, not a guessed quantity', () => {
    const s = suggestScope(
      facts({
        observations: [
          {
            id: 'o1',
            component: 'decking',
            finding: 'Soft decking near the rear valley',
            severity: 'moderate',
            confirmed: true,
          },
        ],
      }),
    )
    const decking = s.find((x) => x.key === 'decking_allowance')
    expect(decking?.reason).toBe('allowance')
    expect(decking?.quantity).toBe(0)
    expect(decking?.needsQuantity).toBe(true)
    expect(decking?.evidence[0]?.referenceId).toBe('o1')
  })

  it('turns "requires verification" into a question, never into scope', () => {
    const s = suggestScope(
      facts({
        observations: [
          {
            id: 'o9',
            component: null,
            finding: 'Possible prior repair at the front slope',
            severity: 'requires_verification',
            confirmed: true,
          },
        ],
      }),
    )
    const v = s.find((x) => x.key === 'verify:o9')
    expect(v?.confidence).toBe('low')
    expect(v?.quantity).toBe(0)
    expect(v?.description).toContain('Verify before pricing')
  })
})

const SHINGLE_SYSTEM: Assembly = {
  id: 'arch-shingle',
  name: 'Architectural shingle replacement',
  components: [
    {
      key: 'field',
      description: 'Architectural shingle',
      category: 'material',
      unit: 'SQ',
      rule: { kind: 'squares', withWaste: true },
      reason: 'delta_ridge_standard',
      materialItemId: 'm1',
      laborItemId: null,
      optional: false,
    },
    {
      key: 'drip_edge',
      description: 'Drip edge',
      category: 'material',
      unit: 'LF',
      rule: { kind: 'eave_plus_rake_lf' },
      reason: 'code_required',
      materialItemId: 'm2',
      laborItemId: null,
      optional: false,
    },
    {
      key: 'cap',
      description: 'Hip and ridge cap',
      category: 'material',
      unit: 'LF',
      rule: { kind: 'ridge_plus_hip_lf' },
      reason: 'manufacturer_required',
      materialItemId: 'm3',
      laborItemId: null,
      optional: false,
    },
    {
      key: 'valley',
      description: 'Valley metal',
      category: 'material',
      unit: 'LF',
      rule: { kind: 'valley_lf' },
      reason: 'delta_ridge_standard',
      materialItemId: 'm4',
      laborItemId: null,
      optional: false,
    },
  ],
}

describe('assemblies expand instead of hiding components', () => {
  it('produces a visible line per component with its derivation', () => {
    const g = geometry()
    const expanded = expandAssembly(SHINGLE_SYSTEM, g, calculateWaste(g))
    expect(keys(expanded)).toEqual(['field', 'drip_edge', 'cap'])
    expect(expanded.find((c) => c.key === 'drip_edge')?.quantity).toBe(140)
    expect(expanded.find((c) => c.key === 'cap')?.quantity).toBe(40)
    expect(expanded.find((c) => c.key === 'field')?.derivation).toContain('waste')
  })

  it('drops a component that resolves to zero rather than pricing it at zero', () => {
    const g = geometry()
    const expanded = expandAssembly(SHINGLE_SYSTEM, g, calculateWaste(g))
    expect(keys(expanded)).not.toContain('valley')
  })

  it('includes valley metal once the roof has valleys', () => {
    const g = geometry({ valleyLf: 64 })
    const expanded = expandAssembly(SHINGLE_SYSTEM, g, calculateWaste(g))
    expect(expanded.find((c) => c.key === 'valley')?.quantity).toBe(64)
  })

  it('orders more field material than the bare measurement', () => {
    const g = geometry()
    const expanded = expandAssembly(SHINGLE_SYSTEM, g, calculateWaste(g))
    const field = expanded.find((c) => c.key === 'field')
    expect(field?.quantity).toBeGreaterThan(32)
  })
})
