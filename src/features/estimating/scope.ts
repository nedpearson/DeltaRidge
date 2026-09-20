import {
  areaAtOrAbovePitch,
  countPenetrations,
  lowSlopeAreaSqFt,
  type RoofGeometry,
} from './geometry'
import type { JobCostCategory } from './cost'
import type { ScopeEvidence, ScopeReason } from './estimate'
import type { Unit } from './price-book'

/**
 * Turns what the inspection actually recorded into PROPOSED scope.
 *
 * Nothing here adds a line to an estimate. Every return value is a
 * suggestion a human confirms, rejects or edits, and it carries the evidence
 * it was derived from so the answer to "why is that on there?" is one tap
 * away rather than a shrug.
 *
 * The rules are deterministic on purpose. This is the layer a model will
 * later feed suggestions INTO; if the deterministic floor is wrong, a model
 * on top of it only makes the wrongness harder to audit.
 */

export type SuggestionConfidence = 'high' | 'medium' | 'low'

export interface ScopeSuggestion {
  readonly key: string
  readonly description: string
  readonly category: JobCostCategory
  readonly quantity: number
  readonly unit: Unit
  readonly reason: ScopeReason
  readonly confidence: SuggestionConfidence
  readonly evidence: readonly ScopeEvidence[]
  /** Shown verbatim next to the confirm button. */
  readonly rationale: string
  /** True when the rep must supply a quantity before this can be priced. */
  readonly needsQuantity: boolean
}

/** The inspection facts the scope rules read. All of them recorded by a human. */
export interface InspectionFacts {
  readonly geometry: RoofGeometry
  readonly observations: readonly ObservationFact[]
  readonly photoCategories: readonly PhotoFact[]
  readonly homeownerStatedRoofAgeYears: number | null
}

export interface ObservationFact {
  readonly id: string
  readonly component: string | null
  readonly finding: string
  readonly severity: 'none_noted' | 'minor' | 'moderate' | 'significant' | 'requires_verification'
  readonly confirmed: boolean
}

export interface PhotoFact {
  readonly id: string
  readonly category: string | null
}

function photosOf(facts: InspectionFacts, category: string): readonly PhotoFact[] {
  return facts.photoCategories.filter((p) => p.category === category)
}

function photoEvidence(photos: readonly PhotoFact[], summary: string): ScopeEvidence[] {
  return photos.map((p) => ({
    kind: 'photo' as const,
    referenceId: p.id,
    summary,
  }))
}

function measurementEvidence(summary: string): ScopeEvidence {
  return { kind: 'measurement', referenceId: null, summary }
}

/**
 * Confirmed observations only. An unconfirmed finding - a voice note nobody
 * reviewed, a model's guess - is not a reason to put material on a contract.
 */
function confirmedObservations(facts: InspectionFacts): readonly ObservationFact[] {
  return facts.observations.filter((o) => o.confirmed)
}

export function suggestScope(facts: InspectionFacts): readonly ScopeSuggestion[] {
  const out: ScopeSuggestion[] = []
  const { geometry } = facts

  // --- Facts from the measurement, not from a judgement call ------------------

  if (geometry.existingLayers > 1) {
    out.push({
      key: 'tear_off_additional_layer',
      description: `Tear off ${geometry.existingLayers - 1} additional layer(s)`,
      category: 'labor',
      quantity: (geometry.facets.reduce((s, f) => s + f.areaSqFt, 0) / 100) *
        (geometry.existingLayers - 1),
      unit: 'SQ',
      reason: 'existing_condition',
      confidence: 'high',
      evidence: [
        measurementEvidence(`${geometry.existingLayers} roof coverings recorded`),
        ...photoEvidence(photosOf(facts, 'decking'), 'Layer count visible at the edge'),
      ],
      rationale: `${geometry.existingLayers} existing layers were recorded, so tear-off is more than one pass.`,
      needsQuantity: false,
    })
  }

  const lowSlope = lowSlopeAreaSqFt(geometry)
  if (lowSlope > 0) {
    out.push({
      key: 'low_slope_system',
      description: 'Low-slope roofing system',
      category: 'material',
      quantity: lowSlope,
      unit: 'SF',
      reason: 'code_required',
      confidence: 'high',
      evidence: [measurementEvidence(`${lowSlope.toFixed(0)} SF measured below 2/12`)],
      rationale:
        'Part of this roof is below the slope a shingle is approved for, so that area needs a ' +
        'different covering. Confirm the applicable requirement for this jurisdiction before pricing.',
      needsQuantity: false,
    })
  }

  const steep = areaAtOrAbovePitch(geometry, 8)
  if (steep > 0) {
    out.push({
      key: 'steep_charge',
      description: 'Steep slope charge',
      category: 'labor',
      quantity: steep,
      unit: 'SF',
      reason: 'access_condition',
      confidence: 'high',
      evidence: [measurementEvidence(`${steep.toFixed(0)} SF at or above 8/12`)],
      rationale: 'Steep facets are slower and need more staging and fall protection.',
      needsQuantity: false,
    })
  }

  if (geometry.stories >= 2 || geometry.eaveHeightFt >= 20) {
    out.push({
      key: 'high_charge',
      description: 'High roof charge',
      category: 'access',
      quantity: 1,
      unit: 'EA',
      reason: 'access_condition',
      confidence: 'high',
      evidence: [
        measurementEvidence(
          `${geometry.stories} stories, ${geometry.eaveHeightFt} ft to the eave`,
        ),
        ...photoEvidence(photosOf(facts, 'access_concern'), 'Access documented on site'),
      ],
      rationale: 'Height drives staging, material handling and debris control.',
      needsQuantity: false,
    })
  }

  return [...out, ...penetrationSuggestions(facts), ...conditionSuggestions(facts)]
}

const PENETRATION_RULES: readonly {
  readonly key: string
  readonly kind: Parameters<typeof countPenetrations>[1]
  readonly photoCategory: string
  readonly description: string
  readonly rationale: string
}[] = [
  {
    key: 'pipe_boot_replacement',
    kind: 'pipe_boot',
    photoCategory: 'pipe_boot',
    description: 'Replace pipe boot',
    rationale: 'A boot reused under a new roof is the most common early leak on a good install.',
  },
  {
    key: 'chimney_flashing',
    kind: 'chimney',
    photoCategory: 'chimney',
    description: 'Chimney flashing and counterflashing',
    rationale: 'A chimney needs new step and counterflashing when the covering is replaced.',
  },
  {
    key: 'skylight_flashing',
    kind: 'skylight',
    photoCategory: 'skylight',
    description: 'Skylight flashing kit',
    rationale: 'Reflashing a skylight is separate from the roof covering.',
  },
  {
    key: 'satellite_detach_reset',
    kind: 'satellite_mount',
    photoCategory: 'satellite_mount',
    description: 'Detach and reset satellite mount',
    rationale: 'Detach and reset is real labour and is routinely left off a bid.',
  },
]

function penetrationSuggestions(facts: InspectionFacts): readonly ScopeSuggestion[] {
  const out: ScopeSuggestion[] = []
  for (const rule of PENETRATION_RULES) {
    const measured = countPenetrations(facts.geometry, rule.kind)
    const photos = photosOf(facts, rule.photoCategory)
    if (measured === 0 && photos.length === 0) continue

    // A photograph proves the thing exists; it does not prove how many there
    // are. When the measurement is silent the rep supplies the count.
    const quantity = measured > 0 ? measured : photos.length
    out.push({
      key: rule.key,
      description: rule.description,
      category: 'material',
      quantity,
      unit: 'EA',
      reason: measured > 0 ? 'delta_ridge_standard' : 'existing_condition',
      confidence: measured > 0 ? 'high' : 'medium',
      evidence: [
        ...(measured > 0
          ? [measurementEvidence(`${measured} recorded in the measurement`)]
          : []),
        ...photoEvidence(photos, `${rule.description} photographed on site`),
      ],
      rationale:
        measured > 0
          ? rule.rationale
          : `${rule.rationale} Counted from ${photos.length} photo(s) - confirm the count.`,
      needsQuantity: measured === 0,
    })
  }
  return out
}

const DECKING_WORDS = /\b(deck|decking|sheathing|plywood|osb|rot|rotten|soft|spongy)\b/i

function conditionSuggestions(facts: InspectionFacts): readonly ScopeSuggestion[] {
  const out: ScopeSuggestion[] = []
  const confirmed = confirmedObservations(facts)

  const deckingFindings = confirmed.filter(
    (o) =>
      DECKING_WORDS.test(o.finding) ||
      (o.component !== null && DECKING_WORDS.test(o.component)),
  )
  const deckingPhotos = photosOf(facts, 'decking')

  if (deckingFindings.length > 0 || deckingPhotos.length > 0) {
    // Deliberately an allowance with no quantity. Decking is hidden until the
    // old roof is off; putting a guessed sheet count in the base price is how
    // an estimate turns into an argument on day two.
    out.push({
      key: 'decking_allowance',
      description: 'Decking replacement allowance',
      category: 'material',
      quantity: 0,
      unit: 'SHEET',
      reason: 'allowance',
      confidence: 'medium',
      evidence: [
        ...deckingFindings.map((o) => ({
          kind: 'inspection_finding' as const,
          referenceId: o.id,
          summary: o.finding,
        })),
        ...photoEvidence(deckingPhotos, 'Decking condition photographed'),
      ],
      rationale:
        'Decking condition is not fully known until tear-off. Price an included allowance and ' +
        'a unit price for anything beyond it, rather than guessing a sheet count now.',
      needsQuantity: true,
    })
  }

  const flashingFindings = confirmed.filter(
    (o) => /\bflashing\b/i.test(o.finding) && o.severity !== 'none_noted',
  )
  if (flashingFindings.length > 0) {
    out.push({
      key: 'flashing_replacement',
      description: 'Replace damaged flashing',
      category: 'material',
      quantity: 0,
      unit: 'LF',
      reason: 'existing_condition',
      confidence: 'medium',
      evidence: flashingFindings.map((o) => ({
        kind: 'inspection_finding' as const,
        referenceId: o.id,
        summary: o.finding,
      })),
      rationale: 'Flashing was recorded as damaged. Confirm the run length before pricing.',
      needsQuantity: true,
    })
  }

  // Severity 'requires_verification' is the inspector saying they are not sure.
  // It never becomes scope on its own; it becomes a question.
  for (const o of confirmed.filter((x) => x.severity === 'requires_verification')) {
    out.push({
      key: `verify:${o.id}`,
      description: `Verify before pricing: ${o.finding}`,
      category: 'contingency',
      quantity: 0,
      unit: 'EA',
      reason: 'existing_condition',
      confidence: 'low',
      evidence: [{ kind: 'inspection_finding', referenceId: o.id, summary: o.finding }],
      rationale:
        'The inspector marked this as needing verification, so it is a question rather than ' +
        'a line item. Resolve it before the estimate is presented.',
      needsQuantity: true,
    })
  }

  return out
}
