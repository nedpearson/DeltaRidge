/**
 * Photo taxonomy. Mirrors the `photo_category` enum in
 * supabase/migrations/20260918_0004_inspections.sql — the two must stay in step.
 *
 * Grouped the way a rep actually walks a property, not alphabetically.
 */

export const PHOTO_CATEGORIES = [
  // Property
  'front_elevation', 'left_elevation', 'rear_elevation', 'right_elevation', 'address_identifier',
  // Roof
  'roof_overview', 'slope_front', 'slope_rear', 'slope_left', 'slope_right',
  'valley', 'ridge', 'hip', 'eave', 'rake_edge',
  // Penetrations
  'vent', 'pipe_boot', 'hvac_penetration', 'skylight', 'chimney', 'satellite_mount', 'flashing',
  // Damage
  'hail_impact', 'wind_damage', 'missing_shingle', 'lifted_shingle', 'creasing',
  'granule_loss', 'exposed_mat', 'puncture', 'soft_metal_impact', 'flashing_damage',
  // Accessories
  'gutter', 'downspout', 'fascia', 'soffit', 'window_screen', 'siding',
  // Other
  'interior_water_damage', 'attic', 'decking', 'access_concern', 'other',
] as const

export type PhotoCategory = (typeof PHOTO_CATEGORIES)[number]

export type PhotoGroup = 'property' | 'roof' | 'penetrations' | 'damage' | 'accessories' | 'other'

export const CATEGORY_GROUP: Record<PhotoCategory, PhotoGroup> = {
  front_elevation: 'property', left_elevation: 'property', rear_elevation: 'property',
  right_elevation: 'property', address_identifier: 'property',
  roof_overview: 'roof', slope_front: 'roof', slope_rear: 'roof', slope_left: 'roof',
  slope_right: 'roof', valley: 'roof', ridge: 'roof', hip: 'roof', eave: 'roof', rake_edge: 'roof',
  vent: 'penetrations', pipe_boot: 'penetrations', hvac_penetration: 'penetrations',
  skylight: 'penetrations', chimney: 'penetrations', satellite_mount: 'penetrations',
  flashing: 'penetrations',
  hail_impact: 'damage', wind_damage: 'damage', missing_shingle: 'damage', lifted_shingle: 'damage',
  creasing: 'damage', granule_loss: 'damage', exposed_mat: 'damage', puncture: 'damage',
  soft_metal_impact: 'damage', flashing_damage: 'damage',
  gutter: 'accessories', downspout: 'accessories', fascia: 'accessories', soffit: 'accessories',
  window_screen: 'accessories', siding: 'accessories',
  interior_water_damage: 'other', attic: 'other', decking: 'other', access_concern: 'other',
  other: 'other',
}

export const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  front_elevation: 'front elevation', left_elevation: 'left elevation',
  rear_elevation: 'rear elevation', right_elevation: 'right elevation',
  address_identifier: 'address identifier',
  roof_overview: 'overall roof', slope_front: 'front slope overview',
  slope_rear: 'rear slope overview', slope_left: 'left slope overview',
  slope_right: 'right slope overview',
  valley: 'valley', ridge: 'ridge', hip: 'hip', eave: 'eave', rake_edge: 'rake edge',
  vent: 'vent', pipe_boot: 'pipe boot', hvac_penetration: 'HVAC penetration',
  skylight: 'skylight', chimney: 'chimney', satellite_mount: 'satellite mount',
  flashing: 'flashing',
  hail_impact: 'hail impact', wind_damage: 'wind damage', missing_shingle: 'missing shingle',
  lifted_shingle: 'lifted shingle', creasing: 'creasing', granule_loss: 'granule loss',
  exposed_mat: 'exposed mat', puncture: 'puncture', soft_metal_impact: 'soft metal impact',
  flashing_damage: 'flashing damage',
  gutter: 'gutter', downspout: 'downspout', fascia: 'fascia', soffit: 'soffit',
  window_screen: 'window screen', siding: 'siding',
  interior_water_damage: 'interior water damage', attic: 'attic', decking: 'decking',
  access_concern: 'access concern', other: 'other',
}

/** Close-up damage categories: meaningful only alongside a wide shot. */
export const DAMAGE_CATEGORIES: PhotoCategory[] = [
  'hail_impact', 'wind_damage', 'missing_shingle', 'lifted_shingle', 'creasing',
  'granule_loss', 'exposed_mat', 'puncture', 'soft_metal_impact', 'flashing_damage',
]

/** Maps a free-text slope name onto the overview photo that should support it. */
export const SLOPE_OVERVIEW_FOR: Record<string, PhotoCategory | undefined> = {
  front: 'slope_front', 'front slope': 'slope_front',
  rear: 'slope_rear', 'rear slope': 'slope_rear', back: 'slope_rear', 'back slope': 'slope_rear',
  left: 'slope_left', 'left slope': 'slope_left',
  right: 'slope_right', 'right slope': 'slope_right',
}

/**
 * The baseline required set for a residential storm-damage inspection.
 *
 * Kept deliberately short. A checklist long enough to feel thorough is a
 * checklist reps start waiving wholesale, at which point it documents nothing.
 * These nine are the ones an office genuinely cannot work without.
 */
export const REQUIRED_RESIDENTIAL: PhotoCategory[] = [
  'front_elevation', 'left_elevation', 'rear_elevation', 'right_elevation',
  'address_identifier', 'roof_overview', 'slope_front', 'slope_rear', 'gutter',
]

/** Suggested (not required) additions, surfaced as prompts in the camera flow. */
export const SUGGESTED_RESIDENTIAL: PhotoCategory[] = [
  'slope_left', 'slope_right', 'valley', 'ridge', 'eave',
  'vent', 'pipe_boot', 'flashing', 'downspout', 'fascia', 'soffit',
]

export function requiredCategoriesFor(propertyType: string, stories?: number | null): PhotoCategory[] {
  const base = [...REQUIRED_RESIDENTIAL]
  // Commercial roofs are flat: slope overviews make no sense, access does.
  if (propertyType === 'commercial') {
    const withoutSlopes = base.filter((c) => !c.startsWith('slope_'))
    return [...withoutSlopes, 'access_concern']
  }
  // A two-storey walkaround needs the extra elevations to show the whole roof.
  if ((stories ?? 1) >= 2 && !base.includes('slope_left')) {
    return [...base, 'slope_left', 'slope_right']
  }
  return base
}
