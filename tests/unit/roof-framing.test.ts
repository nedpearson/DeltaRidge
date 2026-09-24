import { describe, expect, it } from 'vitest'
import { MAX_TILE_ZOOM, metresPerPixel, zoomForGroundSpan } from '@/features/leads/map-projection'
import {
  HOUSE_SPAN_METRES,
  SPAN_STEPS_METRES,
  parcelFrame,
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

describe('the frame has to hold a house in BOTH directions', () => {
  /** What the frame covers top to bottom, given a width span and an element. */
  function tallSpan(widthSpan: number, width: number, height: number): number {
    return (widthSpan * height) / width
  }

  it('shows why a fixed pixel height was the second half of the bug', () => {
    // The card asked for a fixed 128 px height. On a 608 px desktop card that
    // is 4.75:1, so 70 m across came with 15 m top to bottom — a strip of roof
    // rather than a roof. A house is roughly 15 m deep before any margin.
    expect(tallSpan(HOUSE_SPAN_METRES, 608, 128)).toBeLessThan(16)
  })

  it('holds a whole roof once the aspect is fixed instead of the height', () => {
    // 2:1 on the card, 3:2 in the viewer. Both leave room around a 15 m house.
    expect(tallSpan(HOUSE_SPAN_METRES, 2, 1)).toBeGreaterThan(30)
    expect(tallSpan(HOUSE_SPAN_METRES, 3, 2)).toBeGreaterThan(44)
  })

  it('means the same thing at every element width, which a pixel height did not', () => {
    for (const width of [320, 608, 1200]) {
      expect(tallSpan(HOUSE_SPAN_METRES, 2, 1)).toBeCloseTo(35, 6)
      // The point: nothing above depends on `width` at all any more.
      expect(width).toBeGreaterThan(0)
    }
  })
})

describe('framing the lot the parish recorded', () => {
  // A deep lot: 30 m of street frontage, 120 m back. The house is at the front;
  // the ring centroid — which is the only coordinate the app holds — is 60 m
  // behind it, in the trees.
  const DEEP: ReadonlyArray<readonly [number, number]> = [
    [-91.1, 30.4],
    [-91.09969, 30.4],
    [-91.09969, 30.40108],
    [-91.1, 30.40108],
    [-91.1, 30.4],
  ]

  it('frames the lot rather than a fixed distance around its centroid', () => {
    const framed = parcelFrame(DEEP, { width: 608, height: 243 })
    expect(framed).not.toBeNull()
    const heightMetres = metresPerPixel(30.4005, framed!.view.zoom) * 243
    // It has to hold the whole 120 m lot — a 70 m frame centred on the centroid
    // would cut off both the house and the back fence...
    expect(heightMetres).toBeGreaterThan(120)
    // ...and it has to STOP there. This is the assertion that was missing the
    // first time: `padBounds` defaults to a 440 m floor, which inflated every
    // suburban lot to half a subdivision with a small box in the middle. The
    // test passed anyway, because 440 is also greater than 120.
    expect(heightMetres).toBeLessThan(200)
  })

  it('does not inflate a small lot to the default padding floor', () => {
    // 20 m x 20 m: about the tightest a real parcel gets.
    const TINY: ReadonlyArray<readonly [number, number]> = [
      [-91.1, 30.4],
      [-91.099792, 30.4],
      [-91.099792, 30.40018],
      [-91.1, 30.40018],
      [-91.1, 30.4],
    ]
    const framed = parcelFrame(TINY, { width: 608, height: 304 })
    const heightMetres = metresPerPixel(30.4, framed!.view.zoom) * 304
    // `padBounds` defaults to a 440 m floor. With it, this 20 m lot came back in
    // a frame over a kilometre across — half a subdivision with a small orange
    // box somewhere in the middle, which is what Ned's screenshot showed.
    expect(heightMetres).toBeLessThan(90)
    // The lot has to be a real part of the picture, not a speck in it.
    expect(20 / heightMetres).toBeGreaterThan(0.25)
  })

  it('sizes itself to the lot, so a narrow lot and a big block differ', () => {
    const SMALL: ReadonlyArray<readonly [number, number]> = [
      [-91.1, 30.4],
      [-91.09978, 30.4],
      [-91.09978, 30.40018],
      [-91.1, 30.40018],
      [-91.1, 30.4],
    ]
    const big = parcelFrame(DEEP, { width: 608, height: 243 })
    const small = parcelFrame(SMALL, { width: 608, height: 243 })
    // Tighter lot, deeper zoom. A fixed span would have shown both identically.
    expect(small!.view.zoom).toBeGreaterThan(big!.view.zoom)
  })

  it('widens on request without losing the centre', () => {
    const lot = parcelFrame(DEEP, { width: 608, height: 243 }, 1)
    const wider = parcelFrame(DEEP, { width: 608, height: 243 }, 4)
    expect(wider!.view.zoom).toBeCloseTo(lot!.view.zoom - 2, 6)
    expect(wider!.view.center.latitude).toBeCloseTo(lot!.view.center.latitude, 9)
    expect(wider!.view.center.longitude).toBeCloseTo(lot!.view.center.longitude, 9)
  })

  it('refuses a ring that is not a polygon rather than drawing nonsense', () => {
    expect(parcelFrame([], { width: 608, height: 243 })).toBeNull()
    expect(parcelFrame([[-91.1, 30.4], [-91.09, 30.41]], { width: 608, height: 243 })).toBeNull()
    expect(parcelFrame(DEEP, { width: 0, height: 243 })).toBeNull()
  })

  it('drops points that are not coordinates instead of projecting NaN', () => {
    const dirty = [...DEEP, [Number.NaN, 30.4] as const, [-91.1, Number.POSITIVE_INFINITY] as const]
    const framed = parcelFrame(dirty, { width: 608, height: 243 })
    expect(framed).not.toBeNull()
    expect(Number.isFinite(framed!.view.zoom)).toBe(true)
    expect(Number.isFinite(framed!.view.center.latitude)).toBe(true)
  })
})

describe('zooming a lot frame', () => {
  const LOT: ReadonlyArray<readonly [number, number]> = [
    [-91.1, 30.4],
    [-91.09969, 30.4],
    [-91.09969, 30.40036],
    [-91.1, 30.40036],
    [-91.1, 30.4],
  ]
  const SIZE = { width: 608, height: 405 }

  it('goes closer in than the lot, not just wider than it', () => {
    // This was clamped at the lot, so every zoom step tighter than it was a
    // silent no-op: the button moved, the readout moved, the picture did not.
    const lot = parcelFrame(LOT, SIZE, 1)!
    const closer = parcelFrame(LOT, SIZE, 40 / 70)!
    expect(closer.view.zoom).toBeGreaterThan(lot.view.zoom)
    expect(closer.view.zoom).toBeCloseTo(lot.view.zoom - Math.log2(40 / 70), 6)
  })

  it('keeps the centre wherever the zoom goes', () => {
    const steps = [25 / 70, 1, 340 / 70].map((f) => parcelFrame(LOT, SIZE, f)!)
    for (const s of steps) {
      expect(s.view.center.latitude).toBeCloseTo(steps[1]!.view.center.latitude, 9)
      expect(s.view.center.longitude).toBeCloseTo(steps[1]!.view.center.longitude, 9)
    }
  })

  it('stops at what the tiles serve rather than asking for a zoom that has none', () => {
    const absurd = parcelFrame(LOT, SIZE, 0.0001)!
    expect(absurd.view.zoom).toBe(MAX_TILE_ZOOM)
  })

  it('treats a nonsense factor as the lot rather than as infinity', () => {
    const lot = parcelFrame(LOT, SIZE, 1)!
    expect(parcelFrame(LOT, SIZE, 0)!.view.zoom).toBeCloseTo(lot.view.zoom, 6)
    expect(parcelFrame(LOT, SIZE, -3)!.view.zoom).toBeCloseTo(lot.view.zoom, 6)
  })
})
