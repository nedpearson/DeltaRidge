import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SAMPLING,
  GAP_SECONDS,
  segmentsOf,
  shouldKeepPoint,
  trackedSeconds,
  walkedMeters,
} from '@/features/routes/tracking'
import type { RoutePoint } from '@/features/routes/route-store'

/**
 * Two separate honesty problems live in this file.
 *
 * Sampling decides what gets recorded: too much and a doorstep conversation
 * reads as pacing; too little and a real walk disappears.
 *
 * Gaps decide what gets *claimed*. The temptation with a sparse trail is to
 * draw a line between two points and call it the route, which asserts the rep
 * walked somewhere no fix ever put them. That line is an invention and this
 * module refuses to draw it.
 */

const BASE = { latitude: 30.4515, longitude: -91.1871 }

function at(seconds: number, metersNorth: number, accuracy?: number): RoutePoint {
  return {
    id: `p${seconds}`,
    sessionId: 's1',
    recordedAt: new Date(Date.parse('2026-09-23T14:00:00.000Z') + seconds * 1000).toISOString(),
    latitude: BASE.latitude + metersNorth / 111_320,
    longitude: BASE.longitude,
    ...(accuracy !== undefined ? { accuracyMeters: accuracy } : {}),
  }
}

describe('shouldKeepPoint', () => {
  it('always keeps the first fix of a session', () => {
    // It is where the work started; there is nothing to compare it against.
    expect(shouldKeepPoint(at(0, 0), null).keep).toBe(true)
  })

  it('drops a fix that arrives too soon after the last one', () => {
    const first = at(0, 0)
    expect(shouldKeepPoint(at(5, 500), first)).toEqual({ keep: false, reason: 'too-soon' })
  })

  it('drops a fix that has barely moved', () => {
    // A phone standing still wanders by a few metres. Storing that would make
    // a five minute conversation at a door look like somebody pacing.
    const first = at(0, 0)
    expect(shouldKeepPoint(at(60, 4), first)).toEqual({ keep: false, reason: 'too-close' })
  })

  it('keeps a fix that has moved far enough after long enough', () => {
    expect(shouldKeepPoint(at(60, 40), at(0, 0)).keep).toBe(true)
  })

  it('drops a fix too coarse to say which street it is on', () => {
    // Kept, it would later be drawn as a place the rep went.
    expect(shouldKeepPoint(at(60, 40, 500), at(0, 0))).toEqual({ keep: false, reason: 'too-coarse' })
  })

  it('drops a coarse fix even when it is the first of a session', () => {
    expect(shouldKeepPoint(at(0, 0, 900), null).keep).toBe(false)
  })

  it('refuses a candidate that is not a position at all', () => {
    expect(
      shouldKeepPoint({ recordedAt: at(0, 0).recordedAt, latitude: Number.NaN, longitude: 0 }, null),
    ).toEqual({ keep: false, reason: 'not-a-position' })
  })

  it('accepts a tighter rule for a dense street', () => {
    const dense = { ...DEFAULT_SAMPLING, minSpacingMeters: 3, minIntervalMs: 1000 }
    expect(shouldKeepPoint(at(5, 5), at(0, 0), dense).keep).toBe(true)
  })
})

describe('segmentsOf', () => {
  it('marks a long silence as a gap rather than a walk', () => {
    const points = [at(0, 0), at(GAP_SECONDS + 60, 800)]
    const [segment] = segmentsOf(points)
    expect(segment?.gap).toBe(true)
  })

  it('does not mark an ordinary stretch as a gap', () => {
    const [segment] = segmentsOf([at(0, 0), at(60, 40)])
    expect(segment?.gap).toBe(false)
  })

  it('returns nothing for a session with one fix', () => {
    expect(segmentsOf([at(0, 0)])).toEqual([])
  })
})

describe('walkedMeters', () => {
  it('adds up the stretches the phone actually recorded', () => {
    expect(walkedMeters([at(0, 0), at(60, 50), at(120, 100)])).toBeCloseTo(100, 0)
  })

  it('excludes a gap instead of counting it as walking', () => {
    // The number this function produces will end up in somebody's performance
    // review. Whatever happened across a five minute hole — a drive, a coffee,
    // a phone in a bag — measuring it as walking would be making it up.
    const withGap = [at(0, 0), at(60, 50), at(60 + GAP_SECONDS + 60, 3000)]
    expect(walkedMeters(withGap)).toBeCloseTo(50, 0)
  })

  it('is zero for a session that never moved', () => {
    expect(walkedMeters([at(0, 0)])).toBe(0)
  })
})

describe('trackedSeconds', () => {
  it('measures first fix to last fix', () => {
    expect(trackedSeconds([at(0, 0), at(600, 200)])).toBe(600)
  })

  it('is zero when there is nothing to measure between', () => {
    expect(trackedSeconds([at(0, 0)])).toBe(0)
    expect(trackedSeconds([])).toBe(0)
  })
})
