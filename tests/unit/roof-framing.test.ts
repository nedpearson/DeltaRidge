import { describe, expect, it } from 'vitest'
import { MAX_TILE_ZOOM, metresPerPixel, zoomForGroundSpan } from '@/features/leads/map-projection'
import {
  HOUSE_SPAN_METRES,
  SPAN_STEPS_METRES,
  propertySpanUrl,
  spanFeet,
} from '@/features/leads/basemap'

/**
 * The satellite thumbnail's whole job is to show ONE house. It was framing
 * about four, because it asked for a fixed zoom at a fixed pixel size — so the
 * same request covered a different amount of ground on every element it was
 * rendered into.
 *
 * These tests are about the framing meaning the same thing everywhere.
 */

// Baton Rouge. The cosine matters: Mercator stretches with latitude, so a zoom
// that frames one lot here frames rather less further north.
const BR = 30.42

describe('metres per pixel', () => {
  it('matches the known Web Mercator figure at street zoom', () => {
    // 512-pixel tiles, so zoom 18 here is the 256-tile world's zoom 19.
    expect(metresPerPixel(BR, 18)).toBeCloseTo(0.2575, 3)
    // Each zoom level halves it.
    expect(metresPerPixel(BR, 19)).toBeCloseTo(metresPerPixel(BR, 18) / 2, 5)
  })

  it('covers more ground per pixel at the equator than at latitude', () => {
    expect(metresPerPixel(0, 18)).toBeGreaterThan(metresPerPixel(BR, 18))
  })
})

describe('framing by distance rather than by zoom', () => {
  it('frames the same ground whatever the element is', () => {
    // The bug: a card 480 px wide and one 900 px wide asked for the same zoom
    // and got completely different framings — one house against four or five,
    // with nothing on the wider one to say which roof it was about.
    for (const pixels of [280, 480, 900, 1400]) {
      const zoom = zoomForGroundSpan(HOUSE_SPAN_METRES, pixels, BR)
      const covered = metresPerPixel(BR, zoom) * pixels
      expect(covered).toBeCloseTo(HOUSE_SPAN_METRES, 6)
    }
  })

  it('frames the same ground at any latitude', () => {
    for (const latitude of [0, 30.42, 51.5, 64]) {
      const zoom = zoomForGroundSpan(HOUSE_SPAN_METRES, 480, latitude)
      expect(metresPerPixel(latitude, zoom) * 480).toBeCloseTo(HOUSE_SPAN_METRES, 6)
    }
  })

  it('stops at what the tiles actually serve, rather than pretending', () => {
    // A very wide element asking for a very tight frame runs past the deepest
    // zoom the imagery has. It is capped there, so the frame comes back wider
    // than asked for — which is honest, and is why the interactive map's own
    // limit is a separate number from this one.
    const zoom = zoomForGroundSpan(5, 2000, BR)
    expect(zoom).toBe(MAX_TILE_ZOOM)
    expect(metresPerPixel(BR, zoom) * 2000).toBeGreaterThan(5)
  })

  it('does not round to a whole zoom level', () => {
    // Rounding to an integer zoom is a factor-of-two error in framing, which is
    // exactly the difference between one house and four.
    const zoom = zoomForGroundSpan(HOUSE_SPAN_METRES, 480, BR)
    expect(Number.isInteger(zoom)).toBe(false)
  })

  it('refuses nonsense rather than producing a frame from it', () => {
    expect(zoomForGroundSpan(0, 480, BR)).toBe(MAX_TILE_ZOOM)
    expect(zoomForGroundSpan(70, 0, BR)).toBe(MAX_TILE_ZOOM)
    expect(zoomForGroundSpan(-5, 480, BR)).toBe(MAX_TILE_ZOOM)
  })
})

describe('the house frame', () => {
  it('is wide enough for a big roof and tight enough to be about one house', () => {
    // A suburban lot is 20-30 m wide. Two lots of context, not ten.
    expect(HOUSE_SPAN_METRES).toBeGreaterThanOrEqual(50)
    expect(HOUSE_SPAN_METRES).toBeLessThanOrEqual(90)
  })

  it('offers zoom steps that go tighter and wider than the default', () => {
    expect(SPAN_STEPS_METRES).toContain(HOUSE_SPAN_METRES)
    expect(Math.min(...SPAN_STEPS_METRES)).toBeLessThan(HOUSE_SPAN_METRES)
    expect(Math.max(...SPAN_STEPS_METRES)).toBeGreaterThan(HOUSE_SPAN_METRES)
  })

  it('keeps the steps in order, tightest first, with no duplicates', () => {
    const sorted = [...SPAN_STEPS_METRES].sort((a, b) => a - b)
    expect([...SPAN_STEPS_METRES]).toEqual(sorted)
    expect(new Set(SPAN_STEPS_METRES).size).toBe(SPAN_STEPS_METRES.length)
  })

  it('reports the frame in feet, which is what a roofer thinks in', () => {
    expect(spanFeet(70)).toBe(230)
    expect(spanFeet(25)).toBe(82)
  })

  it('draws nothing at all rather than a degenerate frame', () => {
    // An element that has not been measured yet has no width, and a frame built
    // from zero pixels would be a request for the whole planet.
    expect(propertySpanUrl(BR, -91.1, { width: 0, height: 200 })).toBeNull()
    expect(propertySpanUrl(BR, -91.1, { width: 480, height: 0 })).toBeNull()
  })
})
