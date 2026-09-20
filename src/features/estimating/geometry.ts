/**
 * Roof geometry: the measured facts a quantity is derived from.
 *
 * Nothing here is estimated or inferred. Every field arrives from a
 * measurement report, an aerial provider, or a tape on the roof. Anything the
 * estimator is unsure about belongs in `unknowns`, not in a default value
 * that silently becomes a quantity on a contract.
 */

/** Rise over a 12" run. A 8/12 roof has `rise: 8`. */
export interface Pitch {
  readonly rise: number
}

export interface RoofFacet {
  readonly id: string
  /** Plan area is NOT accepted. This is the actual sloped surface area. */
  readonly areaSqFt: number
  readonly pitch: Pitch
}

export interface RoofGeometry {
  readonly facets: readonly RoofFacet[]
  readonly ridgeLf: number
  readonly hipLf: number
  readonly valleyLf: number
  readonly eaveLf: number
  readonly rakeLf: number
  readonly stepFlashingLf: number
  readonly wallFlashingLf: number
  readonly penetrations: readonly RoofPenetration[]
  readonly stories: number
  /** Eave height above grade, feet. Drives staging and the high charge. */
  readonly eaveHeightFt: number
  /** Existing roof coverings present, including the one being removed. */
  readonly existingLayers: number
  /** Fields the measurement source did not supply. Never defaulted to zero. */
  readonly unknowns: readonly (keyof RoofGeometry)[]
}

export type PenetrationKind =
  | 'pipe_boot'
  | 'chimney'
  | 'skylight'
  | 'turbine_vent'
  | 'box_vent'
  | 'power_vent'
  | 'satellite_mount'
  | 'solar_mount'
  | 'other'

export interface RoofPenetration {
  readonly kind: PenetrationKind
  readonly count: number
}

export const SQ_FT_PER_SQUARE = 100

export function totalAreaSqFt(geometry: RoofGeometry): number {
  return geometry.facets.reduce((sum, f) => sum + f.areaSqFt, 0)
}

/** Roofing squares, unrounded. Bundle rounding happens at the material, not here. */
export function totalSquares(geometry: RoofGeometry): number {
  return totalAreaSqFt(geometry) / SQ_FT_PER_SQUARE
}

/** Slope factor for a pitch: sqrt(rise^2 + 144) / 12. 8/12 -> 1.2019. */
export function slopeFactor(pitch: Pitch): number {
  return Math.sqrt(pitch.rise * pitch.rise + 144) / 12
}

/** Area-weighted pitch, for labour rates that step by steepness. */
export function predominantPitch(geometry: RoofGeometry): Pitch {
  const area = totalAreaSqFt(geometry)
  if (area === 0) return { rise: 0 }
  const weighted = geometry.facets.reduce((sum, f) => sum + f.pitch.rise * f.areaSqFt, 0)
  return { rise: weighted / area }
}

export function countPenetrations(geometry: RoofGeometry, kind: PenetrationKind): number {
  return geometry.penetrations
    .filter((p) => p.kind === kind)
    .reduce((sum, p) => sum + p.count, 0)
}

/** Area on facets at or above a pitch, for steep-slope charges. */
export function areaAtOrAbovePitch(geometry: RoofGeometry, rise: number): number {
  return geometry.facets
    .filter((f) => f.pitch.rise >= rise)
    .reduce((sum, f) => sum + f.areaSqFt, 0)
}

/** Area below a pitch, where a shingle is not an approved covering. */
export function lowSlopeAreaSqFt(geometry: RoofGeometry, minShingleRise = 2): number {
  return geometry.facets
    .filter((f) => f.pitch.rise < minShingleRise)
    .reduce((sum, f) => sum + f.areaSqFt, 0)
}

export function isKnown(geometry: RoofGeometry, field: keyof RoofGeometry): boolean {
  return !geometry.unknowns.includes(field)
}
