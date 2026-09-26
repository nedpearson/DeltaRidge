export interface SearchCenter {
  latitude: number
  longitude: number
  accuracyMeters?: number
  capturedAt: string
}

const MILES_PER_DEGREE_LAT = 69.0

export function bboxAround(
  center: Pick<SearchCenter, 'latitude' | 'longitude'>,
  radiusMiles: number,
): [number, number, number, number] {
  const radius = Math.max(0.1, radiusMiles)
  const latDelta = radius / MILES_PER_DEGREE_LAT
  const cos = Math.max(0.15, Math.cos((center.latitude * Math.PI) / 180))
  const lonDelta = radius / (MILES_PER_DEGREE_LAT * cos)

  return [
    center.longitude - lonDelta,
    center.latitude - latDelta,
    center.longitude + lonDelta,
    center.latitude + latDelta,
  ]
}

export function expandBbox(
  bbox: readonly [number, number, number, number],
  miles: number,
): [number, number, number, number] {
  const [west, south, east, north] = bbox
  const centerLat = (south + north) / 2
  const latDelta = miles / MILES_PER_DEGREE_LAT
  const cos = Math.max(0.15, Math.cos((centerLat * Math.PI) / 180))
  const lonDelta = miles / (MILES_PER_DEGREE_LAT * cos)
  return [west - lonDelta, south - latDelta, east + lonDelta, north + latDelta]
}
