import { describe, expect, it } from 'vitest'
import { detectStops, stoppedSeconds } from '@/features/routes/stops'
import {
  classifySegments,
  geometryConfidence,
  modeBreakdown,
} from '@/features/routes/travel-mode'
import { doorTotals, plannedActual, routeStats } from '@/features/routes/route-stats'
import { buildTimeline } from '@/features/routes/timeline'
import { integritySignals, needsReview } from '@/features/routes/integrity'
import type { RoutePoint, RouteSession } from '@/features/routes/route-store'

/**
 * These engines produce the numbers that end up in somebody's performance
 * review, so most of what follows tests what they REFUSE to say rather than
 * what they say.
 */

const T0 = Date.parse('2026-09-23T14:00:00.000Z')

/** One fix. `after` is seconds from T0; `north` is metres north of the origin. */
function fix(after: number, north: number, east = 0, accuracy = 8): RoutePoint {
  return {
    id: `p-${after}`,
    sessionId: 's1',
    recordedAt: new Date(T0 + after * 1000).toISOString(),
    latitude: 30.4 + north / 111_320,
    longitude: -91.1 + east / (111_320 * Math.cos((30.4 * Math.PI) / 180)),
    accuracyMeters: accuracy,
  }
}

const SESSION: RouteSession = {
  id: 's1',
  startedAt: new Date(T0).toISOString(),
  deviceId: 'device-1',
}

describe('stop detection', () => {
  it('reads a stop from two nearby fixes far apart in time', () => {
    // The sampling rule drops fixes within 12 m, so eleven minutes on a
    // doorstep produces two points, not two hundred. Clustering would find
    // nothing; this is why the gap between fixes is what gets read.
    const stops = detectStops([fix(0, 0), fix(660, 6), fix(700, 200)])
    expect(stops).toHaveLength(1)
    expect(stops[0]?.seconds).toBe(660)
    expect(stops[0]?.fixes).toBe(2)
  })

  it('merges consecutive stationary stretches into one stop', () => {
    const stops = detectStops([fix(0, 0), fix(300, 5), fix(600, 9), fix(640, 300)])
    expect(stops).toHaveLength(1)
    expect(stops[0]?.seconds).toBe(600)
  })

  it('ignores a pause at a junction', () => {
    expect(detectStops([fix(0, 0), fix(30, 3), fix(60, 100)])).toHaveLength(0)
  })

  it('refuses to call a long silence a stop', () => {
    // A phone that lost signal on a doorstep and one that lost signal in a
    // pocket look identical. Forty minutes of "standing" would be invented.
    expect(detectStops([fix(0, 0), fix(2400, 5)])).toHaveLength(0)
  })

  it('totals only what it found', () => {
    expect(stoppedSeconds([])).toBe(0)
  })
})

describe('travel mode', () => {
  it('calls walking pace walking and vehicle speed driving', () => {
    const walk = classifySegments([fix(0, 0), fix(60, 90)])
    expect(walk[0]?.mode).toBe('walking')

    const drive = classifySegments([fix(0, 0), fix(60, 600)])
    expect(drive[0]?.mode).toBe('driving')
  })

  it('refuses to split the ambiguous band down the middle', () => {
    // ~3.3 m/s is a jog and a crawl through a subdivision. Picking one would
    // put a made-up mile into a performance figure.
    const mid = classifySegments([fix(0, 0), fix(60, 200)])
    expect(mid[0]?.mode).toBe('unclear')
    expect(mid[0]?.confidence).toBeLessThanOrEqual(0.4)
  })

  it('drops confidence when the accuracy radius could explain the distance', () => {
    // 30 m apart with 25 m accuracy each: possibly the same spot.
    expect(geometryConfidence(30, 25)).toBeLessThan(0.5)
    expect(geometryConfidence(300, 10)).toBeGreaterThan(0.9)
    // Nothing reported means nothing claimed.
    expect(geometryConfidence(100, null)).toBe(0.5)
  })

  it('never accumulates distance across a gap', () => {
    const points = [fix(0, 0), fix(1200, 4000)]
    const breakdown = modeBreakdown(classifySegments(points))
    expect(breakdown.gap.seconds).toBe(1200)
    expect(breakdown.gap.meters).toBe(0)
    expect(breakdown.walking.meters + breakdown.driving.meters).toBe(0)
  })

  it('keeps unclear as its own bucket instead of sharing it out', () => {
    const breakdown = modeBreakdown(classifySegments([fix(0, 0), fix(60, 200)]))
    expect(breakdown.unclear.meters).toBeGreaterThan(0)
    expect(breakdown.walking.meters).toBe(0)
    expect(breakdown.driving.meters).toBe(0)
  })
})

describe('route statistics', () => {
  const points = [fix(0, 0), fix(60, 90), fix(120, 180), fix(1200, 4000), fix(1260, 4090)]

  it('reports the four measures of time separately rather than reconciling them', () => {
    const paused: RouteSession = {
      ...SESSION,
      endedAt: new Date(T0 + 1800 * 1000).toISOString(),
      pauses: [
        {
          at: new Date(T0 + 300 * 1000).toISOString(),
          until: new Date(T0 + 600 * 1000).toISOString(),
        },
      ],
    }
    const stats = routeStats(paused, points)
    expect(stats.routeSeconds).toBe(1800)
    expect(stats.pausedSeconds).toBe(300)
    expect(stats.trackedSeconds).toBe(1260)
    expect(stats.gapSeconds).toBe(1080)
    // Deliberately not equal to each other, and deliberately not forced to be.
    expect(stats.routeSeconds).not.toBe(stats.trackedSeconds + stats.pausedSeconds)
  })

  it('excludes the gap from distance', () => {
    const stats = routeStats(SESSION, points, [], T0 + 1800 * 1000)
    // Roughly 180 m before the gap plus 90 m after it. The 4 km straight line
    // across the gap is not distance anybody travelled.
    expect(stats.distanceMeters).toBeLessThan(400)
  })

  it('carries the worst accuracy so nothing downstream over-claims', () => {
    const stats = routeStats(SESSION, [fix(0, 0, 0, 8), fix(60, 90, 0, 140)])
    expect(stats.worstAccuracyMeters).toBe(140)
  })
})

describe('door totals', () => {
  it('counts one door knocked three times as one door', () => {
    const totals = doorTotals([
      { leadId: 'a', at: '2026-09-23T14:00:00Z', activityType: 'door_knock', outcome: 'no_answer', gpsVerification: 'verified' },
      { leadId: 'a', at: '2026-09-23T15:00:00Z', activityType: 'door_knock', outcome: 'no_answer', gpsVerification: 'verified' },
      { leadId: 'b', at: '2026-09-23T15:10:00Z', activityType: 'door_knock', outcome: 'spoke', gpsVerification: 'probable' },
    ])
    expect(totals.knocks).toBe(3)
    expect(totals.doors).toBe(2)
    expect(totals.conversations).toBe(1)
  })

  it('does not count a door hanger as a conversation', () => {
    const totals = doorTotals([
      { leadId: 'a', at: '2026-09-23T14:00:00Z', activityType: 'door_knock', outcome: 'left_info', gpsVerification: 'verified' },
    ])
    expect(totals.knocks).toBe(1)
    expect(totals.conversations).toBe(0)
  })
})

describe('planned against actual', () => {
  const events = [
    { leadId: 'a', at: '2026-09-23T14:00:00Z', activityType: 'door_knock', outcome: 'no_answer', gpsVerification: 'verified' },
    { leadId: 'z', at: '2026-09-23T14:20:00Z', activityType: 'door_knock', outcome: 'spoke', gpsVerification: 'verified' },
  ]

  it('counts only doors with a recorded outcome, never proximity', () => {
    // Driving past a house is the easiest number in the system to game and the
    // one a manager would most reasonably believe.
    const result = plannedActual(['a', 'b', 'c'], events)
    expect(result.assigned).toBe(3)
    expect(result.knocked).toBe(1)
    expect(result.skipped).toBe(2)
    expect(result.additional).toBe(1)
    expect(result.completion).toBeCloseTo(1 / 3)
  })

  it('reports no completion rather than 100% when nothing was assigned', () => {
    expect(plannedActual([], events).completion).toBeNull()
  })
})

describe('timeline', () => {
  it('shows a gap in both directions instead of skipping over it', () => {
    const entries = buildTimeline(SESSION, [fix(0, 0), fix(1200, 4000)])
    expect(entries.map((e) => e.kind)).toContain('gap_started')
    expect(entries.map((e) => e.kind)).toContain('gap_ended')
  })

  it('never names a cause for a stop', () => {
    const entries = buildTimeline(SESSION, [fix(0, 0), fix(660, 6), fix(700, 200)])
    const stop = entries.find((e) => e.kind === 'stop')
    expect(stop?.detail).toMatch(/not recorded/i)
    expect(stop?.detail).not.toMatch(/lunch|break|conversation|call/i)
  })

  it('puts everything in order', () => {
    const entries = buildTimeline(
      { ...SESSION, endedAt: new Date(T0 + 3600 * 1000).toISOString() },
      [fix(0, 0), fix(60, 90)],
      [
        {
          leadId: 'a',
          at: new Date(T0 + 120 * 1000).toISOString(),
          activityType: 'door_knock',
          outcome: 'spoke',
          gpsVerification: 'verified',
          address: '18818 BELLA VISTA CT',
        },
      ],
    )
    const times = entries.map((e) => e.at)
    expect([...times].sort()).toEqual(times)
    expect(entries[0]?.kind).toBe('route_started')
    expect(entries[entries.length - 1]?.kind).toBe('route_ended')
  })
})

describe('integrity signals', () => {
  const knock = (leadId: string, at: number, verification: string) => ({
    leadId,
    at: new Date(T0 + at * 1000).toISOString(),
    activityType: 'door_knock',
    outcome: 'no_answer',
    gpsVerification: verification,
  })

  it('says nothing about an ordinary route', () => {
    expect(integritySignals([fix(0, 0), fix(60, 90)], [knock('a', 30, 'verified')])).toEqual([])
  })

  it('never uses the language of accusation', () => {
    const knocks = Array.from({ length: 14 }, (_, i) => knock(`d${i}`, i * 20, 'unverified'))
    const signals = integritySignals([fix(0, 0), fix(60, 90)], knocks)
    expect(signals.length).toBeGreaterThan(0)
    const text = JSON.stringify(signals).toLowerCase()
    for (const word of ['fraud', 'lying', 'cheat', 'falsif', 'dishonest']) {
      expect(text).not.toContain(word)
    }
  })

  it('offers the ordinary explanation on every signal it raises', () => {
    const knocks = Array.from({ length: 14 }, (_, i) => knock(`d${i}`, i * 20, 'unverified'))
    for (const signal of integritySignals([fix(0, 0), fix(60, 90)], knocks)) {
      expect(signal.ordinary.length).toBeGreaterThan(20)
      expect(signal.check.length).toBeGreaterThan(20)
    }
  })

  it('does not raise the unverified pattern from a handful of fixes', () => {
    // One bad afternoon is weather, not behaviour.
    const few = [knock('a', 0, 'unverified'), knock('b', 60, 'unverified')]
    const codes = integritySignals([fix(0, 0), fix(60, 90)], few).map((s) => s.code)
    expect(codes).not.toContain('mostly_unverified')
  })

  it('flags a route left open with nothing happening as a UI problem', () => {
    const signals = integritySignals([fix(0, 0), fix(600, 5)], [], {
      routeOpen: true,
      routeSeconds: 7200,
    })
    const idle = signals.find((s) => s.code === 'open_route_no_movement')
    expect(idle?.ordinary).toMatch(/forgot to end/i)
    expect(needsReview(signals)).toBe(false)
  })
})
