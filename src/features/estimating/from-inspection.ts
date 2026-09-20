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
  readonly pipeBoots?: string
}

export function seedFrom(
  inspection: LocalInspection | null,
  photos: readonly LocalPhoto[],
): GeometrySeed {
  const seed: { stories?: string; pipeBoots?: string } = {}
  if (inspection?.stories !== undefined) seed.stories = String(inspection.stories)

  // A photograph proves a boot exists; it does not prove how many there are.
  // Seeding the count from photos gives the rep a starting number they can see
  // and correct, which beats an empty field they may not think to fill.
  const bootPhotos = photos.filter((p) => p.category === 'pipe_boot').length
  if (bootPhotos > 0) seed.pipeBoots = String(bootPhotos)

  return seed
}
