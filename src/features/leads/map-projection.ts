/**
 * Putting the door list on a picture, without a map vendor.
 *
 * There is no basemap here on purpose. Street tiles need a Mapbox token this
 * deployment does not have, they are a network round trip a rep in a truck may
 * not get, and the map library is larger than the rest of the application.
 * What a rep actually needs from a map at a door is which houses on this
 * street are done and which are not, and that is geometry, not cartography.
 *
 * Everything here is pure so the projection can be tested without a DOM.
 */

export interface GeoPoint {
  readonly latitude: number
  readonly longitude: number
}

export interface Bounds {
  readonly west: number
  readonly south: number
  readonly east: number
  readonly north: number
}

export interface Size {
  readonly width: number
  readonly height: number
}

export function boundsOf(points: readonly GeoPoint[]): Bounds | null {
  if (points.length === 0) return null

  let west = Number.POSITIVE_INFINITY
  let south = Number.POSITIVE_INFINITY
  let east = Number.NEGATIVE_INFINITY
  let north = Number.NEGATIVE_INFINITY

  for (const p of points) {
    if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) continue
    if (p.longitude < west) west = p.longitude
    if (p.longitude > east) east = p.longitude
    if (p.latitude < south) south = p.latitude
    if (p.latitude > north) north = p.latitude
  }

  if (!Number.isFinite(west)) return null
  return { west, south, east, north }
}

/**
 * Grows a box by a fraction of its own size, with a floor.
 *
 * The floor is what stops a single door — or two houses on the same street —
 * from projecting to a degenerate box and being scaled to infinity.
 */
export function padBounds(bounds: Bounds, fraction = 0.08, minimumDegrees = 0.004): Bounds {
  const spanX = Math.max(bounds.east - bounds.west, minimumDegrees)
  const spanY = Math.max(bounds.north - bounds.south, minimumDegrees)
  const cx = (bounds.east + bounds.west) / 2
  const cy = (bounds.north + bounds.south) / 2
  const halfX = (spanX * (1 + fraction * 2)) / 2
  const halfY = (spanY * (1 + fraction * 2)) / 2

  return {
    west: cx - halfX,
    east: cx + halfX,
    south: cy - halfY,
    north: cy + halfY,
  }
}

/**
 * Equirectangular, with longitude compressed by the cosine of the centre
 * latitude.
 *
 * At Baton Rouge a degree of longitude is about 86% of a degree of latitude.
 * Without that correction a subdivision comes out visibly stretched east-west
 * and a rep cannot match what is on screen to the street they are parked on.
 * A full Mercator projection buys nothing across three miles.
 */
export function project(point: GeoPoint, bounds: Bounds, size: Size): { x: number; y: number } {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180)
  const squeeze = Math.cos(midLat)

  const spanX = (bounds.east - bounds.west) * squeeze
  const spanY = bounds.north - bounds.south
  if (spanX <= 0 || spanY <= 0) return { x: size.width / 2, y: size.height / 2 }

  // One scale for both axes, chosen so the wider span fits. Scaling each axis
  // independently would fill the box and silently distort distances.
  const scale = Math.min(size.width / spanX, size.height / spanY)
  const drawnWidth = spanX * scale
  const drawnHeight = spanY * scale
  const offsetX = (size.width - drawnWidth) / 2
  const offsetY = (size.height - drawnHeight) / 2

  return {
    x: offsetX + (point.longitude - bounds.west) * squeeze * scale,
    // SVG y grows downward; north is up.
    y: offsetY + (bounds.north - point.latitude) * scale,
  }
}

/** Roughly how far across the view is, for the scale bar. */
export function spanMiles(bounds: Bounds): number {
  const midLat = ((bounds.north + bounds.south) / 2) * (Math.PI / 180)
  const milesPerDegreeLat = 69.0
  const east = (bounds.east - bounds.west) * Math.cos(midLat) * milesPerDegreeLat
  return Math.round(east * 10) / 10
}
