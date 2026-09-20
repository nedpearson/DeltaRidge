import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  centerOf,
  mercatorX,
  mercatorY,
  mercatorYToLatitude,
  offsetCenter,
  padBounds,
  project,
  spanMiles,
  TILE,
  viewForBounds,
  worldSize,
  zoomBy,
  zoomToFit,
  type Bounds,
  type View,
} from '@/features/leads/map-projection'

const SIZE = { width: 320, height: 240 }

/** Roughly the service area: Baton Rouge. */
const AREA: Bounds = { west: -91.1, south: 30.3, east: -91.0, north: 30.4 }

describe('bounds', () => {
  it('is nothing when there is nothing to plot', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('wraps every point', () => {
    expect(
      boundsOf([
        { latitude: 30.3, longitude: -91.1 },
        { latitude: 30.4, longitude: -91.0 },
        { latitude: 30.35, longitude: -91.05 },
      ]),
    ).toEqual({ west: -91.1, south: 30.3, east: -91.0, north: 30.4 })
  })

  it('ignores a point with no usable coordinates rather than collapsing', () => {
    expect(
      boundsOf([
        { latitude: 30.3, longitude: -91.1 },
        { latitude: Number.NaN, longitude: Number.NaN },
        { latitude: 30.4, longitude: -91.0 },
      ]),
    ).toEqual({ west: -91.1, south: 30.3, east: -91.0, north: 30.4 })
  })

  it('is nothing when no point has usable coordinates', () => {
    expect(boundsOf([{ latitude: Number.NaN, longitude: Number.NaN }])).toBeNull()
  })

  it('gives a single door a box to sit in instead of a point', () => {
    const padded = padBounds({ west: -91.05, south: 30.35, east: -91.05, north: 30.35 })
    expect(padded.east - padded.west).toBeGreaterThan(0)
    expect(padded.north - padded.south).toBeGreaterThan(0)
  })
})

describe('mercator', () => {
  it('puts the prime meridian and the equator at the middle of the world', () => {
    expect(mercatorX(0)).toBeCloseTo(0.5, 12)
    expect(mercatorY(0)).toBeCloseTo(0.5, 12)
  })

  it('puts north above the equator', () => {
    expect(mercatorY(45)).toBeLessThan(0.5)
  })

  it('inverts itself', () => {
    for (const lat of [-60, -30.35, 0, 30.35, 60]) {
      expect(mercatorYToLatitude(mercatorY(lat))).toBeCloseTo(lat, 9)
    }
  })

  it('does not run to infinity at the poles', () => {
    expect(Number.isFinite(mercatorY(90))).toBe(true)
    expect(Number.isFinite(mercatorY(-90))).toBe(true)
  })

  it('uses the 512-pixel tile Mapbox styles are served at', () => {
    // A factor-of-two error here looks almost right and puts every door on the
    // wrong street, so it is pinned rather than assumed.
    expect(TILE).toBe(512)
    expect(worldSize(0)).toBe(512)
    expect(worldSize(10)).toBe(512 * 1024)
  })
})

describe('fitting a view to the work', () => {
  it('centres in mercator, not on the average of the corners', () => {
    const centre = centerOf(AREA)
    expect(centre.longitude).toBeCloseTo(-91.05, 10)
    // Mercator stretches northwards, so the centre sits north of the mean.
    expect(centre.latitude).toBeGreaterThan(30.35)
    expect(centre.latitude).toBeLessThan(30.3501)
  })

  it('picks a zoom at which the whole box still fits', () => {
    const view = viewForBounds(AREA, SIZE)
    for (const p of [
      { latitude: AREA.north, longitude: AREA.west },
      { latitude: AREA.south, longitude: AREA.east },
    ]) {
      const { x, y } = project(p, view, SIZE)
      expect(x).toBeGreaterThanOrEqual(-1e-9)
      expect(x).toBeLessThanOrEqual(SIZE.width + 1e-9)
      expect(y).toBeGreaterThanOrEqual(-1e-9)
      expect(y).toBeLessThanOrEqual(SIZE.height + 1e-9)
    }
  })

  it('does not zoom past the limit for one lonely door', () => {
    const one: Bounds = { west: -91.05, south: 30.35, east: -91.05, north: 30.35 }
    expect(zoomToFit(one, SIZE)).toBe(16)
  })

  it('zooms out for a wider area', () => {
    const wide: Bounds = { west: -92, south: 29.5, east: -90, north: 31 }
    expect(zoomToFit(wide, SIZE)).toBeLessThan(zoomToFit(AREA, SIZE))
  })
})

describe('projection', () => {
  const view = viewForBounds(AREA, SIZE)

  it('puts the centre of the view at the centre of the canvas', () => {
    const { x, y } = project(view.center, view, SIZE)
    expect(x).toBeCloseTo(SIZE.width / 2, 9)
    expect(y).toBeCloseTo(SIZE.height / 2, 9)
  })

  it('puts north at the top and east to the right', () => {
    const north = project({ latitude: 30.4, longitude: -91.05 }, view, SIZE)
    const south = project({ latitude: 30.3, longitude: -91.05 }, view, SIZE)
    const west = project({ latitude: 30.35, longitude: -91.1 }, view, SIZE)
    const east = project({ latitude: 30.35, longitude: -91.0 }, view, SIZE)
    expect(north.y).toBeLessThan(south.y)
    expect(east.x).toBeGreaterThan(west.x)
  })

  it('doubles the distance between two doors for every zoom level', () => {
    const a = { latitude: 30.34, longitude: -91.06 }
    const b = { latitude: 30.36, longitude: -91.04 }
    const near = project(a, view, SIZE)
    const far = project(b, view, SIZE)
    const zoomed = zoomBy(view, 1)
    const nearIn = project(a, zoomed, SIZE)
    const farIn = project(b, zoomed, SIZE)

    const before = Math.hypot(far.x - near.x, far.y - near.y)
    const after = Math.hypot(farIn.x - nearIn.x, farIn.y - nearIn.y)
    expect(after / before).toBeCloseTo(2, 6)
  })
})

describe('panning', () => {
  const view: View = viewForBounds(AREA, SIZE)

  it('moves the centre by exactly the pixels it was dragged', () => {
    const moved: View = { center: offsetCenter(view, 40, -25), zoom: view.zoom }
    const where = project(view.center, moved, SIZE)
    expect(where.x).toBeCloseTo(SIZE.width / 2 - 40, 6)
    expect(where.y).toBeCloseTo(SIZE.height / 2 + 25, 6)
  })

  it('comes back to where it started', () => {
    const there: View = { center: offsetCenter(view, 60, 30), zoom: view.zoom }
    const back = offsetCenter(there, -60, -30)
    expect(back.longitude).toBeCloseTo(view.center.longitude, 9)
    expect(back.latitude).toBeCloseTo(view.center.latitude, 9)
  })
})

describe('scale', () => {
  it('measures what is on screen, not the box the doors sit in', () => {
    // The box is about 6 miles wide, but it is taller than it is wide relative
    // to a 320x240 canvas, so height sets the zoom and the view spills either
    // side: roughly 9 miles of longitude are actually visible. Reporting the
    // box instead would tell a rep the screen covers less than it does.
    const miles = spanMiles(viewForBounds(AREA, SIZE), SIZE)
    expect(miles).toBeGreaterThan(8.5)
    expect(miles).toBeLessThan(10)
  })

  it('halves when you zoom in one level', () => {
    const view = viewForBounds(AREA, SIZE)
    const wide = spanMiles(view, SIZE)
    const close = spanMiles(zoomBy(view, 1), SIZE)
    expect(close).toBeLessThan(wide)
    expect(close / wide).toBeCloseTo(0.5, 1)
  })
})
