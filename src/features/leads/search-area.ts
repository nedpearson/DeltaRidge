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


export function circlePolygon(
  center: Pick<SearchCenter, 'latitude' | 'longitude'>,
  radiusMiles: number,
  steps = 64,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const radiusKm = Math.max(0.1, radiusMiles) * 1.609344
  const earthKm = 6371.0088
  const lat1 = (center.latitude * Math.PI) / 180
  const lon1 = (center.longitude * Math.PI) / 180
  const angular = radiusKm / earthKm
  const coords: [number, number][] = []

  for (let i = 0; i <= steps; i += 1) {
    const bearing = (2 * Math.PI * i) / steps
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angular) +
        Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing),
    )
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1),
        Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
      )
    coords.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }

  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coords] },
  }
}
