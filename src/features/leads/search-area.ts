export interface SearchCenter {
  latitude: number
  longitude: number
  accuracyMeters?: number
}

const EARTH_RADIUS_M = 6_371_008.8

/**
 * Geodesic circle used only as a visual search boundary on the map.
 * Filtering still uses haversine distance in the lead engine; the polygon is
 * presentation, not the source of truth.
 */
export function searchCircleGeoJson(
  center: SearchCenter,
  radiusMiles: number,
  steps = 72,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const radiusM = Math.max(0, radiusMiles) * 1609.344
  const angular = radiusM / EARTH_RADIUS_M
  const lat1 = (center.latitude * Math.PI) / 180
  const lon1 = (center.longitude * Math.PI) / 180
  const ring: [number, number][] = []

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
    ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI])
  }

  return {
    type: 'Feature',
    properties: { radiusMiles },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

export function northEdge(center: SearchCenter, radiusMiles: number): SearchCenter {
  const milesPerLatDegree = 69
  return {
    latitude: center.latitude + radiusMiles / milesPerLatDegree,
    longitude: center.longitude,
  }
}
