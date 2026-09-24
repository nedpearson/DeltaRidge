import { describe, expect, it } from 'vitest'
import { countByYear, resolveWindow, WINDOW_OPTIONS } from '@/features/leads/window'
import {
  buildCoverage,
  emptyWindowExplanation,
  RADAR_NOT_CONFIGURED,
} from '@/features/leads/coverage'
import type { StormEvent } from '@/integrations/storm'

const NOW = new Date('2026-09-20T15:30:00.000Z')

function event(occurredAt: string, hail = 1): StormEvent {
  return {
    externalId: occurredAt,
    provider: 'noaa',
    eventType: 'hail',
    occurredAt,
    hailSizeInches: hail,
    latitude: 30.5,
    longitude: -91,
  }
}

/**
 * The window the whole complaint was about. "Last 24 months" buried four 2026
 * events under twenty-two from 2025 and never said so.
 */
describe('this year', () => {
  it('runs from January 1 of the current year to now', () => {
    const w = resolveWindow('this_year', NOW)
    expect(new Date(w.from).getFullYear()).toBe(2026)
    expect(new Date(w.from).getMonth()).toBe(0)
    expect(new Date(w.from).getDate()).toBe(1)
    expect(w.to).toBe(NOW.toISOString())
  })

  it('is labelled with the year, not a month count', () => {
    expect(resolveWindow('this_year', NOW).label).toBe('2026 storms')
    expect(resolveWindow('this_year', new Date('2027-01-02T00:00:00Z')).label).toBe('2027 storms')
  })

  it('starts at the beginning of January when it is January', () => {
    const w = resolveWindow('this_year', new Date('2026-01-02T12:00:00Z'))
    expect(new Date(w.from).getFullYear()).toBe(2026)
    expect(new Date(w.from).getMonth()).toBe(0)
  })
})

describe('the other windows', () => {
  it('offers every option the screen shows', () => {
    expect(WINDOW_OPTIONS.map((o) => o.key)).toEqual([
      'this_year', 'last_30_days', 'last_90_days',
      'last_6_months', 'last_12_months', 'last_24_months', 'custom',
    ])
  })

  it('resolves rolling windows backwards from now', () => {
    expect(resolveWindow('last_30_days', NOW).from).toBe('2026-08-21T15:30:00.000Z')
    expect(resolveWindow('last_24_months', NOW).from).toBe('2024-09-20T15:30:00.000Z')
  })

  it('uses the supplied custom range', () => {
    const w = resolveWindow('custom', NOW, { from: '2026-03-01', to: '2026-05-31' })
    expect(w.from.slice(0, 10)).toBe('2026-03-01')
    expect(w.label).toContain('2026-03-01')
  })

  /** Silently using different dates than the ones on screen is the failure. */
  it('says so when a custom range is missing rather than pretending', () => {
    expect(resolveWindow('custom', NOW).label).toContain('not set')
  })
})

describe('coverage reports the sources separately', () => {
  const events = [
    event('2025-03-31T20:00:00Z', 1.75),
    event('2025-07-30T18:00:00Z'),
    event('2026-03-09T23:30:00Z'),
    event('2026-05-08T12:52:00Z'),
  ]

  it('counts the current year on its own', () => {
    const c = buildCoverage(resolveWindow('last_24_months', NOW), events, [], false)
    expect(c.totalEvents).toBe(4)
    expect(c.currentYearEvents).toBe(2)
  })

  it('reports oldest and newest so freshness is visible', () => {
    const c = buildCoverage(resolveWindow('last_24_months', NOW), events, [], false)
    expect(c.oldestAt).toBe('2025-03-31T20:00:00Z')
    expect(c.newestAt).toBe('2026-05-08T12:52:00Z')
  })

  it('breaks the count down by year', () => {
    expect(countByYear(events.map((e) => e.occurredAt))).toEqual([
      { year: '2026', count: 2 },
      { year: '2025', count: 2 },
    ])
  })

  /**
   * The load-bearing one: radar hail must never be folded into the official
   * count, because a blended number reads as completeness.
   */
  it('names radar as not configured instead of blending it in', () => {
    const c = buildCoverage(resolveWindow('this_year', NOW), events, [], false)
    expect(c.radar.kind).toBe('not_configured')
    if (c.radar.kind === 'not_configured') {
      expect(c.radar.why).toContain('MRMS/MESH')
      expect(c.radar.why).toContain('not configured')
    }
    expect(c.official.kind).toBe('live')
  })

  it('distinguishes a failed feed from genuinely quiet weather', () => {
    const failed = buildCoverage(resolveWindow('this_year', NOW), [], [], true)
    expect(emptyWindowExplanation(failed)).toContain('not a statement about the weather')

    const quiet = buildCoverage(resolveWindow('this_year', NOW), [], [], false)
    expect(emptyWindowExplanation(quiet)).toContain('No official hail reports')
    expect(emptyWindowExplanation(quiet)).toContain('would not appear here')
  })

  it('carries an explicit radar status when one is supplied', () => {
    const c = buildCoverage(resolveWindow('this_year', NOW), events, [], false, {
      kind: 'live',
      newestAt: '2026-09-20T14:00:00Z',
      count: 11,
    })
    expect(c.radar.kind).toBe('live')
  })

  /**
   * The counterpart to the blending test above, now that radar actually runs.
   * The official row has to keep counting official reports only, and its
   * "most recent" has to stay a date somebody actually reported something on.
   */
  it('keeps the official count and its newest date free of radar', () => {
    const radar = [
      { ...event('2026-09-20T22:10:00Z', 1.5), observation: 'radar_estimate' as const },
      { ...event('2026-09-21T01:00:00Z', 2), observation: 'radar_estimate' as const },
    ]
    const c = buildCoverage(resolveWindow('last_24_months', NOW), events, radar, false, {
      kind: 'live',
      newestAt: '2026-09-21T01:00:00Z',
      count: radar.length,
    })

    expect(c.official.kind).toBe('live')
    if (c.official.kind === 'live') {
      expect(c.official.count).toBe(4)
      expect(c.official.newestAt).toBe('2026-05-08T12:52:00Z')
    }
    expect(c.radar.kind).toBe('live')
    if (c.radar.kind === 'live') expect(c.radar.count).toBe(2)
    // The combined figure is allowed to be combined — it is the list length.
    expect(c.totalEvents).toBe(6)
  })

  it('never claims radar coverage by default', () => {
    expect(RADAR_NOT_CONFIGURED.kind).toBe('not_configured')
  })
})
