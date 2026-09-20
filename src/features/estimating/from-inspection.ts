import type { LocalInspection, LocalObservation, LocalPhoto } from '@/lib/db'
import type { InspectionFacts, ObservationFact, PhotoFact } from './scope'
import type { RoofGeometry } from './geometry'

/**
 * Turns what the inspection recorded into the facts the scope rules read.
 *
 * The measurements are NOT in the inspection - Delta Ridge has no measurement
 * provider yet, so the rep types them on the estimate screen. Everything else
 * comes straight from what was captured on the roof, which is the whole point
 * of attaching an estimate to an inspection rather than starting from a blank
 * form and retyping it.
 */

/**
 * Only CONFIRMED observations become facts the scope rules act on.
 *
 * An observation is confirmed when a human marked it so. Anything else - a
 * voice note nobody reviewed, a suggestion nobody accepted - is carried
 * through with confirmed:false and the scope rules ignore it. That decision
 * lives in scope.ts; this function must not quietly pre-approve anything by
 * defaulting the flag the other way.
 */
export function observationFacts(
  observations: readonly LocalObservation[],
): readonly ObservationFact[] {
  return observations.map((o) => ({
    id: o.id,
    component: o.component ?? null,
    finding: o.finding,
    severity: o.severity,
    confirmed: o.confirmedAt !== undefined,
  }))
}

export function photoFacts(photos: readonly LocalPhoto[]): readonly PhotoFact[] {
  return photos.map((p) => ({ id: p.id, category: p.category }))
}

export function factsFrom(
  inspection: LocalInspection | null,
  photos: readonly LocalPhoto[],
  observations: readonly LocalObservation[],
  geometry: RoofGeometry,
): InspectionFacts {
  return {
    geometry,
    observations: observationFacts(observations),
    photoCategories: photoFacts(photos),
    homeownerStatedRoofAgeYears: inspection?.homeownerStatedRoofAgeYears ?? null,
  }
}

/**
 * What the inspection already knows about the roof, used to seed the
 * measurement form so the rep is not retyping what they recorded.
 *
 * Only fields the inspection actually holds. Nothing is inferred: a missing
 * storey count stays missing rather than becoming 1, because a defaulted
 * measurement is indistinguishable on screen from a measured one.
 */
export interface GeometrySeed {
  readonly stories?: string
}

/**
 * Only facts the inspection RECORDED, never anything derived from them.
 *
 * Storeys are seeded because the rep entered that number. A pipe boot count
 * deliberately is NOT, even though the photos imply one, and the reason is
 * worth keeping: the scope rules distinguish a count that came from a
 * measurement (high confidence, priced) from one inferred from photographs
 * (medium confidence, "confirm the count"). Writing the photo-derived number
 * into the measurement field erases that distinction - the suggestion then
 * reads "HIGH CONFIDENCE, MEASUREMENT" for a number nobody measured.
 *
 * Observed on screen before it was removed. The suggestion already handles
 * this better than a seeded field can: it shows the count, says where it came
 * from, and asks the rep to confirm it.
 */
export function seedFrom(inspection: LocalInspection | null): GeometrySeed {
  const seed: { stories?: string } = {}
  if (inspection?.stories !== undefined) seed.stories = String(inspection.stories)
  return seed
}
