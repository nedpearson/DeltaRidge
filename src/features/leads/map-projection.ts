/**
 * Web Mercator, at the tile size Mapbox styles use.
 *
 * This was equirectangular while there was no basemap, which was fine for a
 * cloud of dots and wrong the moment a street map goes underneath them: the
 * tiles are Mercator, and a projection that disagrees with them puts a door on
 * the wrong side of a road at high zoom. So the overlay now uses exactly the
 * maths the basemap does, expressed the same way the static image endpoint
 * takes it — a centre, a zoom and a pixel size.
 *
 * Mapbox GL styles are served as 512-pixel tiles, and the static image API
 * follows the same zoom convention, so TILE is 512 rather than the 256 that
 * older slippy-map maths assumes. Getting that wrong is a factor-of-two error
 * in scale that looks almost right, which is the worst kind.
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

/** A centre and a zoom: what both the basemap and the overlay are drawn from. */
export interface View {
  readonly center: GeoPoint
  readonly zoom: number
}

export const TILE = 512
export const MIN_ZOOM = 1
/**
 * The furthest the interactive map lets a rep zoom.
 *
 * Deliberately short of what the tiles support: past this, panning a hand-drawn
 * overlay over a static image gets fiddly on a phone and the extra detail is
 * not what the door list is for.
 */
export const MAX_ZOOM = 20
/**
 * What the tile source itself will actually serve.
 *
 * Separate from MAX_ZOOM because a single-house frame is a different question
 * from a pannable map: framing 70 m of ground across a wide desktop panel
 * genuinely needs zoom 20.4, and clamping that to the map's own limit would
 * silently give back a frame 30% wider than the one that was asked for.
 */
export const MAX_TILE_ZOOM = 22

/** The latitude past which Mercator runs to infinity. */
const MAX_LATITUDE = 85.05112878

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Longitude to a 0..1 position across the world. */
export function mercatorX(longitude: number): number {
  return (longitude + 180) / 360
}

/** Latitude to a 0..1 position down the world. */
export function mercatorY(latitude: number): number {
  const rad = (clamp(latitude, -MAX_LATITUDE, MAX_LATITUDE) * Math.PI) / 180
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)
}

export function mercatorYToLatitude(y: number): number {
  return (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * y)))
}

export function worldSize(zoom: number): number {
  return TILE * 2 ** zoom
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
 * The box that holds most of the work, ignoring the stragglers.
 *
 * Fitting every last door means fitting the two outliers eight miles from the
 * rest, which pushes the centre into a field between subdivisions — so the map
 * opens on empty ground and zooming in goes nowhere near a house. Trimming the
 * extremes puts the centre where the doors actually are. The outliers are
 * still drawn; they are just allowed to sit off the edge until you zoom out.
 */
export function workingBounds(points: readonly GeoPoint[], trim = 0.05): Bounds | null {
  const usable = points.filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
  if (usable.length === 0) return null
  // Below about twenty doors every point is most of the picture, so trimming
  // would throw away real work rather than noise.
  if (usable.length < 20) return boundsOf(usable)

  const lons = usable.map((p) => p.longitude).sort((a, b) => a - b)
  const lats = usable.map((p) => p.latitude).sort((a, b) => a - b)
  const low = Math.floor(usable.length * trim)
  const high = Math.ceil(usable.length * (1 - trim)) - 1

  return {
    west: lons[low] as number,
    east: lons[high] as number,
    south: lats[low] as number,
    north: lats[high] as number,
  }
}

/**
 * The centre of a box in Mercator, not the average of its corners.
 *
 * Averaging the latitudes puts the centre slightly south of where the tiles
 * put it, which shifts every dot by a few pixels against the streets.
 */
export function centerOf(bounds: Bounds): GeoPoint {
  return {
    longitude: (bounds.west + bounds.east) / 2,
    latitude: mercatorYToLatitude((mercatorY(bounds.north) + mercatorY(bounds.south)) / 2),
  }
}

/** The largest zoom at which the whole box still fits in the box of pixels. */
export function zoomToFit(bounds: Bounds, size: Size): number {
  const spanX = Math.abs(mercatorX(bounds.east) - mercatorX(bounds.west))
  const spanY = Math.abs(mercatorY(bounds.south) - mercatorY(bounds.north))

  const zx = spanX > 0 ? Math.log2(size.width / (TILE * spanX)) : Number.POSITIVE_INFINITY
  const zy = spanY > 0 ? Math.log2(size.height / (TILE * spanY)) : Number.POSITIVE_INFINITY
  const zoom = Math.min(zx, zy)

  // Both spans zero means one point: there is no "fit", so pick a street-level
  // zoom rather than the infinity the maths hands back.
  if (!Number.isFinite(zoom)) return 16
  return clamp(zoom, MIN_ZOOM, MAX_ZOOM)
}

export function viewForBounds(bounds: Bounds, size: Size): View {
  return { center: centerOf(bounds), zoom: zoomToFit(bounds, size) }
}

/** Where a point lands in the pixel box, given the view drawn underneath it. */
export function project(point: GeoPoint, view: View, size: Size): { x: number; y: number } {
  const ws = worldSize(view.zoom)
  return {
    x: (mercatorX(point.longitude) - mercatorX(view.center.longitude)) * ws + size.width / 2,
    y: (mercatorY(point.latitude) - mercatorY(view.center.latitude)) * ws + size.height / 2,
  }
}

/**
 * Moves the centre by a pixel offset. This is what a drag actually does: the
 * finger moves the map, so the centre moves the opposite way.
 */
export function offsetCenter(view: View, dx: number, dy: number): GeoPoint {
  const ws = worldSize(view.zoom)
  const x = mercatorX(view.center.longitude) + dx / ws
  const y = clamp(mercatorY(view.center.latitude) + dy / ws, 0, 1)
  return {
    longitude: ((((x % 1) + 1) % 1) * 360) - 180,
    latitude: mercatorYToLatitude(y),
  }
}

export function zoomBy(view: View, factor: number): View {
  return { center: view.center, zoom: clamp(view.zoom + factor, MIN_ZOOM, MAX_ZOOM) }
}

/**
 * How much ground one pixel covers, in metres.
 *
 * Web Mercator stretches with latitude, so this is not a constant for a given
 * zoom — a frame that shows one lot in Baton Rouge shows rather less in
 * Anchorage. The cosine is what makes a satellite thumbnail frame the same
 * amount of ground wherever the door is.
 */
export function metresPerPixel(latitude: number, zoom: number): number {
  const EQUATOR_METRES = 40_075_017
  return (EQUATOR_METRES * Math.cos((latitude * Math.PI) / 180)) / worldSize(zoom)
}

/**
 * The zoom that frames a given width of ground in a given width of pixels.
 *
 * This is the honest way to ask for "one house". A fixed zoom frames a fixed
 * number of PIXELS of ground, so the same zoom that neatly holds one lot on a
 * phone card holds four on a wide screen, and the house the card is about ends
 * up as one roof among several with nothing to say which. Asking for a distance
 * instead makes the framing mean the same thing everywhere.
 *
 * Not clamped to whole zooms: Mapbox's static endpoint takes fractional zoom,
 * and rounding to an integer is a factor-of-two error in framing.
 */
export function zoomForGroundSpan(metres: number, pixels: number, latitude: number): number {
  if (!(metres > 0) || !(pixels > 0)) return MAX_TILE_ZOOM
  const EQUATOR_METRES = 40_075_017
  const zoom = Math.log2((EQUATOR_METRES * Math.cos((latitude * Math.PI) / 180) * pixels) / (TILE * metres))
  return clamp(zoom, MIN_ZOOM, MAX_TILE_ZOOM)
}

/** Roughly how far across the view is, for the scale readout. */
export function spanMiles(view: View, size: Size): number {
  // 24,901 miles around the equator, narrowing by the cosine of the latitude.
  const equator = 24901
  const metresPerWorld = worldSize(view.zoom)
  const fractionOfWorld = size.width / metresPerWorld
  const miles = fractionOfWorld * equator * Math.cos((view.center.latitude * Math.PI) / 180)
  return miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10
}
