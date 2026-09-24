import { describe, expect, it } from 'vitest'
import {
  collapseToDailyMax,
  monthChunks,
  parseSwdiCsv,
  swdiUrl,
  SwdiStormProvider,
  type SwdiRow,
} from '@/integrations/storm/swdi'
import { flagCorroboration } from '@/features/leads/engine'
import { scoreLeads, stormPhrase, type LeadCandidate } from '@/features/leads/scoring'
import type { PermitRecord } from '@/integrations/permits/types'
import type { StormEvent } from '@/integrations/storm'

/**
 * Radar-estimated hail.
 *
 * Two things are being pinned here, and only one of them is plumbing.
 *
 * The plumbing: SWDI's CSV has a trailing `summary` block that is not a data
 * row, a 744-hour range limit that forces monthly chunking, and one detection
 * per storm cell per volume scan per radar — 4,217 rows describing 87 hail days
 * over the service area. Getting any of those wrong produces a number that is
 * confidently wrong rather than obviously broken.
 *
 * The one that matters: a radar estimate is not a report, and the difference
 * has to survive all the way to the sentence a rep says at a door.
 */

const BBOX: [number, number, number, number] = [-91.5, 30.1, -90.5, 30.9]

/** A real response body, trimmed. Header, rows, then SWDI's summary trailer. */
const LIVE_BODY = [
  'ZTIME,WSR_ID,CELL_ID,PROB,SEVPROB,MAXSIZE,LAT,LON',
  '2026-05-08T13:00:58Z,KDGX,S1,100,60,1.25,30.652,-91.447',
  '2026-05-08T13:10:04Z,KDGX,S1,100,80,1.75,30.692,-91.412',
  '2026-05-08T13:14:22Z,KLCH,S1,100,80,1.50,30.693,-91.411',
  'summary',
  'count,3',
  'totalTimeInSeconds,0.032',
].join('\n')

function row(overrides: Partial<SwdiRow> = {}): SwdiRow {
  return {
    ztime: '2026-05-08T13:00:00Z',
    wsrId: 'KDGX',
    cellId: 'S1',
    maxSizeInches: 1.25,
    latitude: 30.65,
    longitude: -91.44,
    severeProbability: 60,
    ...overrides,
  }
}

function radarEvent(overrides: Partial<StormEvent> = {}): StormEvent {
  return {
    externalId: 'nx3hail|2026-05-08|1533|-4572',
    provider: 'swdi',
    eventType: 'hail',
    occurredAt: '2026-05-08T13:10:04Z',
    hailSizeInches: 1.75,
    latitude: 30.69,
    longitude: -91.41,
    observation: 'radar_estimate',
    radarConfidence: 'radar_only',
    ...overrides,
  }
}

describe('SWDI request shape', () => {
  it('splits a window into calendar months, because SWDI refuses over 744 hours', () => {
    const chunks = monthChunks('2025-01-15T00:00:00.000Z', '2025-03-04T00:00:00.000Z')
    expect(chunks).toHaveLength(3)
    expect(swdiUrl(BBOX, chunks[0]!.from, chunks[0]!.to)).toContain('20250115:20250131')
    expect(swdiUrl(BBOX, chunks[1]!.from, chunks[1]!.to)).toContain('20250201:20250228')
    // The final chunk stops at the window, not at the end of the month.
    expect(swdiUrl(BBOX, chunks[2]!.from, chunks[2]!.to)).toContain('20250301:20250304')
  })

  it('never emits a chunk longer than 31 days', () => {
    const chunks = monthChunks('2024-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z')
    expect(chunks.length).toBeGreaterThan(20)
    for (const c of chunks) {
      const hours = (c.to.getTime() - c.from.getTime()) / 3_600_000
      expect(hours).toBeLessThanOrEqual(744)
    }
  })

  it('sends the bbox in west,south,east,north order', () => {
    const url = swdiUrl(BBOX, new Date('2026-05-01'), new Date('2026-05-31'))
    expect(url).toContain('bbox=-91.5,30.1,-90.5,30.9')
  })

  it('returns nothing for an inverted or empty window rather than asking upstream', () => {
    expect(monthChunks('2026-05-01T00:00:00Z', '2026-01-01T00:00:00Z')).toEqual([])
  })
})

describe('SWDI response parsing', () => {
  it('stops at the summary trailer instead of parsing it as a row', () => {
    const { rows, count } = parseSwdiCsv(LIVE_BODY)
    expect(rows).toHaveLength(3)
    expect(count).toBe(3)
    for (const r of rows) {
      expect(Number.isFinite(r.latitude)).toBe(true)
      expect(Number.isFinite(r.maxSizeInches)).toBe(true)
    }
  })

  it('reads a no-hail answer as zero rather than as a failure', () => {
    expect(parseSwdiCsv('summary\ncount,0\ntotalTimeInSeconds,0.0')).toEqual({
      rows: [],
      count: 0,
    })
  })

  it('throws on a validation error, which is our bug and not quiet weather', () => {
    expect(() =>
      parseSwdiCsv("error,ERROR VALIDATING 'dateRange=startDate:endDate'."),
    ).toThrow(/SWDI rejected/)
  })
})

describe('collapsing scans into events', () => {
  /**
   * The load-bearing reduction. Four radars re-detect one cell every volume
   * scan; left raw, a single afternoon would out-vote a year of weather purely
   * by row count.
   */
  it('keeps one reading per place per day, at the largest size seen', () => {
    const collapsed = collapseToDailyMax([
      row({ ztime: '2026-05-08T13:00:00Z', maxSizeInches: 1.25 }),
      row({ ztime: '2026-05-08T13:06:00Z', maxSizeInches: 1.75, wsrId: 'KLCH' }),
      row({ ztime: '2026-05-08T13:12:00Z', maxSizeInches: 1.0, wsrId: 'KPOE' }),
    ])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]?.maxSizeInches).toBe(1.75)
  })

  it('does not merge different days at the same place', () => {
    const collapsed = collapseToDailyMax([
      row({ ztime: '2026-05-08T13:00:00Z' }),
      row({ ztime: '2026-05-09T13:00:00Z' }),
    ])
    expect(collapsed).toHaveLength(2)
  })

  it('does not merge places miles apart on the same day', () => {
    const collapsed = collapseToDailyMax([
      row({ latitude: 30.65, longitude: -91.44 }),
      row({ latitude: 30.4, longitude: -91.0 }),
    ])
    expect(collapsed).toHaveLength(2)
  })
})

describe('SwdiStormProvider', () => {
  function provider(body: string) {
    const urls: string[] = []
    const fetchImpl = ((input: RequestInfo | URL) => {
      urls.push(input instanceof URL ? input.toString() : String(input))
      return Promise.resolve(new Response(body, { status: 200 }))
    }) as typeof fetch
    return { urls, provider: new SwdiStormProvider(fetchImpl) }
  }

  it('labels every event as a radar estimate, never as a report', async () => {
    const { provider: p } = provider(LIVE_BODY)
    const events = await p.searchEvents({
      bbox: BBOX,
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T00:00:00.000Z',
      eventTypes: ['hail'],
    })
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) {
      expect(e.observation).toBe('radar_estimate')
      expect(e.provider).toBe('swdi')
      expect(e.magnitudeNote).toContain('not an observation of hail on the ground')
    }
  })

  it('applies the size floor it was given', async () => {
    const { provider: p } = provider(LIVE_BODY)
    const events = await p.searchEvents({
      bbox: BBOX,
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T00:00:00.000Z',
      minHailSizeInches: 1.5,
    })
    expect(events.every((e) => (e.hailSizeInches ?? 0) >= 1.5)).toBe(true)
  })

  it('produces the same id for the same day and place on a re-run', async () => {
    const a = await provider(LIVE_BODY).provider.searchEvents({
      bbox: BBOX,
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T00:00:00.000Z',
    })
    const b = await provider(LIVE_BODY).provider.searchEvents({
      bbox: BBOX,
      from: '2026-05-01T00:00:00.000Z',
      to: '2026-05-31T00:00:00.000Z',
    })
    expect(a.map((e) => e.externalId)).toEqual(b.map((e) => e.externalId))
  })

  it('offers no footprint polygon, because a cell centroid is not a swath', async () => {
    await expect(provider(LIVE_BODY).provider.eventGeometry()).resolves.toBeNull()
  })
})

describe('corroboration', () => {
  const report: StormEvent = {
    externalId: 'lsr|1',
    provider: 'noaa',
    eventType: 'hail',
    occurredAt: '2026-05-08T13:30:00Z',
    hailSizeInches: 1,
    latitude: 30.7,
    longitude: -91.4,
    observation: 'official_report',
  }

  it('marks a radar estimate corroborated when a report is near it the same day', () => {
    const [flagged] = flagCorroboration([radarEvent()], [report])
    expect(flagged?.radarConfidence).toBe('corroborated')
  })

  it('marks it radar-only when the nearest report is a different day', () => {
    const [flagged] = flagCorroboration(
      [radarEvent()],
      [{ ...report, occurredAt: '2026-05-09T13:30:00Z' }],
    )
    expect(flagged?.radarConfidence).toBe('radar_only')
  })

  it('marks it radar-only when the report is far away', () => {
    const [flagged] = flagCorroboration([radarEvent()], [{ ...report, latitude: 31.5 }])
    expect(flagged?.radarConfidence).toBe('radar_only')
  })

  it('does not drop uncorroborated estimates — sparse spotters are not absent hail', () => {
    expect(flagCorroboration([radarEvent()], [])).toHaveLength(1)
  })
})

/**
 * The claim-truthfulness guard, at the only place it can be enforced: the words
 * a rep reads off the card.
 */
describe('what a rep is told', () => {
  it('says "reported" only for a ground report', () => {
    const ground: StormEvent = {
      externalId: 'lsr|1',
      provider: 'noaa',
      eventType: 'hail',
      occurredAt: '2026-05-08T13:30:00Z',
      hailSizeInches: 1.75,
      latitude: 30.7,
      longitude: -91.4,
      observation: 'official_report',
    }
    expect(stormPhrase(ground, 1.2)).toContain('hail reported')
  })

  it('never says a radar estimate was reported', () => {
    const phrase = stormPhrase(radarEvent(), 0.8)
    expect(phrase).toContain('Radar estimated')
    expect(phrase).toContain('nobody reported hail on the ground')
    expect(phrase).not.toMatch(/\bhail reported\b/)
  })

  it('says so plainly when a ground report does back the radar up', () => {
    const phrase = stormPhrase(radarEvent({ radarConfidence: 'corroborated' }), 0.8)
    expect(phrase).toContain('Radar estimated')
    expect(phrase).toContain('reported on the ground nearby')
  })

  it('treats an event with no recorded source as a ground report, as it was', () => {
    const legacy: StormEvent = {
      externalId: 'lsr|legacy',
      provider: 'noaa',
      eventType: 'hail',
      occurredAt: '2026-05-08T13:30:00Z',
      hailSizeInches: 1.25,
      latitude: 30.7,
      longitude: -91.4,
    }
    expect(stormPhrase(legacy, 1)).toContain('hail reported')
  })

  it('carries the distinction into the scored lead a rep actually sees', () => {
    const permit: PermitRecord = {
      externalId: 'p1',
      kind: 'new_build',
      address: '1 TEST DR',
      addressKey: '1 test dr',
      issuedAt: '2005-06-01',
      latitude: 30.69,
      longitude: -91.41,
    } as PermitRecord

    const candidate: LeadCandidate = {
      addressKey: '1 test dr',
      address: '1 TEST DR',
      latitude: 30.69,
      longitude: -91.41,
      roofPermit: permit,
    }

    const { leads } = scoreLeads({
      candidates: [candidate],
      storms: [radarEvent()],
      reroofPermits: [],
      radiusMiles: 3,
      minHailInches: 1,
      now: new Date('2026-09-24T12:00:00Z'),
    })

    expect(leads).toHaveLength(1)
    const reasons = leads[0]?.reasons.join(' ') ?? ''
    expect(reasons).toContain('Radar estimated')
    expect(reasons).not.toMatch(/\bhail reported\b/)
    expect(leads[0]?.breakdown.some((f) => f.label === 'Close to the radar estimate')).toBe(true)
    expect(leads[0]?.breakdown.some((f) => f.detail.includes('radar estimate'))).toBe(true)
  })
})
