import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  padBounds,
  project,
  spanMiles,
  type Bounds,
} from '@/features/leads/map-projection'

const SIZE = { width: 320, height: 240 }

/** Roughly the service area: Baton Rouge. */
const AREA: Bounds = { west: -91.1, south: 30.3, east: -91.0, north: 30.4 }

describe('bounds', () => {
  it('is nothing when there is nothing to plot', () => {
    expect(boundsOf([])).toBeNull()
  })

  it('wraps every point', () => {
    const b = boundsOf([
      { latitude: 30.3, longitude: -91.1 },
      { latitude: 30.4, longitude: -91.0 },
      { latitude: 30.35, longitude: -91.05 },
    ])
    expect(b).toEqual({ west: -91.1, south: 30.3, east: -91.0, north: 30.4 })
  })

  it('ignores a point with no usable coordinates rather than collapsing', () => {
    const b = boundsOf([
      { latitude: 30.3, longitude: -91.1 },
      { latitude: Number.NaN, longitude: Number.NaN },
      { latitude: 30.4, longitude: -91.0 },
    ])
    expect(b).toEqual({ west: -91.1, south: 30.3, east: -91.0, north: 30.4 })
  })

  it('is nothing when no point has usable coordinates', () => {
    expect(boundsOf([{ latitude: Number.NaN, longitude: Number.NaN }])).toBeNull()
  })
})

describe('padding', () => {
  it('grows the box around its own centre', () => {
    const padded = padBounds(AREA, 0.1)
    expect(padded.west).toBeLessThan(AREA.west)
    expect(padded.east).toBeGreaterThan(AREA.east)
    expect((padded.east + padded.west) / 2).toBeCloseTo((AREA.east + AREA.west) / 2, 10)
  })

  it('gives a single door a box to sit in instead of a point', () => {
    const one: Bounds = { west: -91.05, south: 30.35, east: -91.05, north: 30.35 }
    const padded = padBounds(one)
    expect(padded.east - padded.west).toBeGreaterThan(0)
    expect(padded.north - padded.south).toBeGreaterThan(0)
  })
})

describe('projection', () => {
  it('puts north at the top, not the bottom', () => {
    const north = project({ latitude: 30.4, longitude: -91.05 }, AREA, SIZE)
    const south = project({ latitude: 30.3, longitude: -91.05 }, AREA, SIZE)
    expect(north.y).toBeLessThan(south.y)
  })

  it('puts east to the right', () => {
    const west = project({ latitude: 30.35, longitude: -91.1 }, AREA, SIZE)
    const east = project({ latitude: 30.35, longitude: -91.0 }, AREA, SIZE)
    expect(east.x).toBeGreaterThan(west.x)
  })

  it('keeps every point inside the canvas', () => {
    // A corner point lands exactly on the edge, and floating point puts it a
    // ten-thousandth of a billionth of a pixel outside. Clamping the
    // projection to hide that would be dishonest about what it computes, and
    // no renderer can tell the difference, so the tolerance lives here.
    const epsilon = 1e-9
    for (const p of [
      { latitude: 30.3, longitude: -91.1 },
      { latitude: 30.4, longitude: -91.0 },
      { latitude: 30.35, longitude: -91.05 },
    ]) {
      const { x, y } = project(p, AREA, SIZE)
      expect(x).toBeGreaterThanOrEqual(-epsilon)
      expect(x).toBeLessThanOrEqual(SIZE.width + epsilon)
      expect(y).toBeGreaterThanOrEqual(-epsilon)
      expect(y).toBeLessThanOrEqual(SIZE.height + epsilon)
    }
  })

  it('uses one scale for both axes, so a square block is not drawn as a rectangle', () => {
    // A tenth of a degree of latitude is longer on the ground than a tenth of
    // a degree of longitude at this latitude, so it must be longer on screen.
    const a = project({ latitude: 30.3, longitude: -91.05 }, AREA, SIZE)
    const b = project({ latitude: 30.4, longitude: -91.05 }, AREA, SIZE)
    const c = project({ latitude: 30.35, longitude: -91.1 }, AREA, SIZE)
    const d = project({ latitude: 30.35, longitude: -91.0 }, AREA, SIZE)
    expect(Math.abs(a.y - b.y)).toBeGreaterThan(Math.abs(c.x - d.x))
  })

  it('centres rather than dividing by zero when there is nothing to span', () => {
    const flat: Bounds = { west: -91, south: 30, east: -91, north: 30 }
    expect(project({ latitude: 30, longitude: -91 }, flat, SIZE)).toEqual({ x: 160, y: 120 })
  })
})

describe('scale', () => {
  it('reports a tenth of a degree near Baton Rouge as about six miles', () => {
    expect(spanMiles(AREA)).toBeGreaterThan(5)
    expect(spanMiles(AREA)).toBeLessThan(7)
  })
})
