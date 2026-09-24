import { describe, expect, it } from 'vitest'
import {
  candidatesFromPermits,
  contractorActivity,
  distanceMiles,
  roundToTotal,
  scoreLeads,
  type LeadCandidate,
} from '@/features/leads/scoring'
import type { PermitRecord } from '@/integrations/permits/types'
import type { StormEvent } from '@/integrations/storm/types'

const NOW = new Date('2026-09-19T12:00:00.000Z')

/**
 * A Partial that also accepts an explicit `undefined`.
 *
 * These builders spread their overrides, so `{ parcel: undefined }` is how a
 * test says "there is no parcel". `exactOptionalPropertyTypes` rejects that
 * against a plain `Partial<T>`, which is correct for application code and
 * wrong for a fixture whose whole job is to remove a field.
 */
type Absent<T> = { [K in keyof T]?: T[K] | undefined }

function permit(over: Absent<PermitRecord> = {}): PermitRecord {
  return {
    externalId: 'p1',
    provider: 'ebr',
    kind: 'new_build',
    permitType: 'New Building Permit (R)',
    issuedAt: '2012-05-01T00:00:00.000',
    address: '19718 SOUTHERN HILLS AVE',
    addressKey: '19718 southern hills ave',
    latitude: 30.35,
    longitude: -91.05,
    ...over,
  } as PermitRecord
}

function candidate(over: Partial<LeadCandidate> = {}): LeadCandidate {
  return {
    addressKey: '19718 southern hills ave',
    address: '19718 SOUTHERN HILLS AVE',
    latitude: 30.35,
    longitude: -91.05,
    roofPermit: permit(),
    ...over,
  }
}

function storm(over: Partial<StormEvent> = {}): StormEvent {
  return {
    externalId: 's1',
    provider: 'noaa',
    eventType: 'hail',
    occurredAt: '2026-05-01T00:00:00.000Z',
    hailSizeInches: 1.75,
    latitude: 30.355,
    longitude: -91.05,
    ...over,
  }
}

describe('distanceMiles', () => {
  it('is zero for the same point', () => {
    expect(distanceMiles(30.35, -91.05, 30.35, -91.05)).toBe(0)
  })

  it('measures a known separation', () => {
    // One degree of latitude is ~69 miles anywhere on earth.
    expect(distanceMiles(30, -91, 31, -91)).toBeCloseTo(69, 0)
  })

  it('is symmetric', () => {
    const a = distanceMiles(30.35, -91.05, 30.45, -91.15)
    const b = distanceMiles(30.45, -91.15, 30.35, -91.05)
    expect(a).toBeCloseTo(b, 9)
  })
})

describe('scoreLeads', () => {
  const base = { radiusMiles: 3, minHailInches: 1, now: NOW }

  it('ranks a qualifying roof and explains why', () => {
    const { leads } = scoreLeads({ ...base, candidates: [candidate()], storms: [storm()], reroofPermits: [] })
    expect(leads).toHaveLength(1)
    expect(leads[0]?.score).toBeGreaterThan(0)
    expect(leads[0]?.reasons[0]).toContain('hail reported')
    expect(leads[0]?.reasons).toContain('No re-roof permit on file after this storm')
  })

  it('drops a roof that was re-roofed after the storm — the whole point', () => {
    const replaced: PermitRecord = permit({
      kind: 'reroof',
      permitType: 'Re-Roof (R)',
      issuedAt: '2026-06-15T00:00:00.000',
    })
    const { leads, suppressed } = scoreLeads({
      ...base,
      candidates: [candidate()],
      storms: [storm()],
      reroofPermits: [replaced],
    })
    expect(leads).toHaveLength(0)
    expect(suppressed.alreadyReplaced).toBe(1)
  })

  it('keeps a roof re-roofed BEFORE the storm, and ages it from that permit', () => {
    const older: PermitRecord = permit({
      kind: 'reroof',
      permitType: 'Re-Roof (R)',
      issuedAt: '2015-01-10T00:00:00.000',
    })
    const { leads } = scoreLeads({
      ...base,
      candidates: [candidate()],
      storms: [storm()],
      reroofPermits: [older],
    })
    expect(leads).toHaveLength(1)
    // Aged from the 2015 re-roof, not the 2012 build.
    expect(leads[0]?.components.roofAgeYears).toBeCloseTo(11.7, 0)
    expect(leads[0]?.reasons[1]).toContain('Roof last permitted')
  })

  it('drops a roof that is too new to sell', () => {
    const { leads, suppressed } = scoreLeads({
      ...base,
      candidates: [candidate({ roofPermit: permit({ issuedAt: '2023-01-01T00:00:00.000' }) })],
      storms: [storm()],
      reroofPermits: [],
    })
    expect(leads).toHaveLength(0)
    expect(suppressed.roofTooNew).toBe(1)
  })

  it('drops a roof outside the radius', () => {
    const { leads, suppressed } = scoreLeads({
      ...base,
      candidates: [candidate()],
      storms: [storm({ latitude: 31.5 })],
      reroofPermits: [],
    })
    expect(leads).toHaveLength(0)
    expect(suppressed.noQualifyingHail).toBe(1)
  })

  it('ignores hail below the threshold and wind entirely', () => {
    const { leads } = scoreLeads({
      ...base,
      candidates: [candidate()],
      storms: [storm({ hailSizeInches: 0.5 }), storm({ externalId: 's2', eventType: 'wind', hailSizeInches: 3 })],
      reroofPermits: [],
    })
    expect(leads).toHaveLength(0)
  })

  it('picks the nearest qualifying storm, not the first', () => {
    const far = storm({ externalId: 'far', latitude: 30.38 })
    const near = storm({ externalId: 'near', latitude: 30.3505 })
    const { leads } = scoreLeads({ ...base, candidates: [candidate()], storms: [far, near], reroofPermits: [] })
    expect(leads[0]?.storm.externalId).toBe('near')
  })

  it('scores bigger, closer, fresher hail on an older roof above the alternative', () => {
    const good = candidate({ addressKey: 'a', address: 'A ST' })
    const meh = candidate({
      addressKey: 'b',
      address: 'B ST',
      latitude: 30.38,
      roofPermit: permit({ issuedAt: '2016-01-01T00:00:00.000' }),
    })
    const { leads } = scoreLeads({
      ...base,
      candidates: [meh, good],
      storms: [storm(), storm({ externalId: 's2', latitude: 30.381, hailSizeInches: 1, occurredAt: '2025-01-01T00:00:00.000Z' })],
      reroofPermits: [],
    })
    expect(leads.map((l) => l.address)).toEqual(['A ST', 'B ST'])
  })

  it('never emits a score above 100 or below 0', () => {
    const { leads } = scoreLeads({
      ...base,
      candidates: [candidate({ roofPermit: permit({ issuedAt: '2011-01-01T00:00:00.000' }) })],
      storms: [storm({ hailSizeInches: 4, occurredAt: NOW.toISOString(), latitude: 30.35 })],
      reroofPermits: [],
    })
    expect(leads[0]?.score).toBeLessThanOrEqual(100)
    expect(leads[0]?.score).toBeGreaterThanOrEqual(0)
  })
})

describe('candidatesFromPermits', () => {
  it('keeps one candidate per address, using the newest permit', () => {
    const out = candidatesFromPermits([
      permit({ externalId: 'old', issuedAt: '2012-01-01T00:00:00.000' }),
      permit({ externalId: 'new', issuedAt: '2014-01-01T00:00:00.000' }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.roofPermit.externalId).toBe('new')
  })

  it('skips permits with no coordinates and non-build permits', () => {
    const out = candidatesFromPermits([
      permit({ addressKey: 'x', latitude: undefined, longitude: undefined }),
      permit({ addressKey: 'y', kind: 'reroof' }),
    ])
    expect(out).toHaveLength(0)
  })
})

describe('contractorActivity', () => {
  it('ranks contractors by re-roof permits pulled', () => {
    const rows = contractorActivity([
      permit({ kind: 'reroof', contractorName: 'Premier South LLC', projectValue: 20000 }),
      permit({ kind: 'reroof', contractorName: 'Premier South LLC', projectValue: 10000 }),
      permit({ kind: 'reroof', contractorName: 'Garcia Roofing', projectValue: 15000 }),
    ])
    expect(rows[0]?.contractorName).toBe('Premier South LLC')
    expect(rows[0]?.permits).toBe(2)
    expect(rows[0]?.totalValue).toBe(30000)
  })

  it('excludes the N/A placeholder, which is common and would top the table', () => {
    const rows = contractorActivity([
      permit({ kind: 'reroof', contractorName: 'N/A' }),
      permit({ kind: 'reroof', contractorName: 'N/A' }),
      permit({ kind: 'reroof', contractorName: 'Garcia Roofing' }),
    ])
    expect(rows.map((r) => r.contractorName)).toEqual(['Garcia Roofing'])
  })

  it('ignores permits that are not re-roofs', () => {
    expect(contractorActivity([permit({ kind: 'new_build', contractorName: 'Builder' })])).toEqual([])
  })
})

describe('which storm a door is scored against', () => {
  // The bug this locks down: selection was by distance alone, so a dense
  // cluster of old, small reports captured every door and the list read as if
  // nothing had happened since. Verified against the live feed: the nearest
  // report to most Baton Rouge candidates was from March 2025.
  const old = storm({
    externalId: 'old-near',
    occurredAt: '2025-03-31T00:00:00.000Z',
    hailSizeInches: 1.0,
    latitude: 30.3505,
    longitude: -91.05,
  })
  const recent = storm({
    externalId: 'recent-far',
    occurredAt: '2026-08-21T00:00:00.000Z',
    hailSizeInches: 1.75,
    latitude: 30.36,
    longitude: -91.05,
  })

  it('cites the bigger, fresher storm over the marginally nearer one', () => {
    const { leads } = scoreLeads({
      candidates: [candidate()],
      storms: [old, recent],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })

    expect(leads).toHaveLength(1)
    expect(leads[0]?.storm.externalId).toBe('recent-far')
  })

  it('does not suppress a roof re-done before the most recent storm', () => {
    // Re-roofed after a 2015 storm, hit again in 2026. Testing the re-roof
    // against the CITED storm instead of the newest one dropped this door.
    const { leads, suppressed } = scoreLeads({
      candidates: [candidate()],
      storms: [
        storm({ externalId: 'ancient', occurredAt: '2015-04-01T00:00:00.000Z', latitude: 30.3505 }),
        recent,
      ],
      reroofPermits: [
        permit({
          externalId: 'r1',
          kind: 'reroof',
          permitType: 'Re-Roof (R)',
          issuedAt: '2015-06-01T00:00:00.000',
        }),
      ],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })

    expect(suppressed.alreadyReplaced).toBe(0)
    expect(leads).toHaveLength(1)
  })
})

describe('candidatesFromPermits with parcel records', () => {
  const located = permit({
    address: '18834 SANTA MARIA PKWY BATON ROUGE LA 70809',
    addressKey: '18834 santa maria pkwy baton rouge la 70809',
    latitude: 30.3,
    longitude: -91.1,
  })

  const parcelRecord = {
    externalId: 'ebr:009-8202-4',
    provider: 'ebr' as const,
    parcelNumber: '009-8202-4',
    address: '18834 SANTA MARIA PKWY',
    addressKey: '18834 santa maria pkwy',
    parish: 'East Baton Rouge',
    ownerName: 'MANCUSO, WILLIAM DAVID',
    ownerKind: 'person' as const,
    ownerConfidence: 'high' as const,
    occupancy: 'owner_occupied' as const,
    occupancyBasis: 'homestead_exemption' as const,
    subdivision: 'SANTA MARIA',
    latitude: 30.343521,
    longitude: -91.005993,
    retrievedAt: '2026-09-23T00:00:00.000Z',
  }

  // The permit address carries a city/state/ZIP tail the parcel roll does not.
  // Matching on the raw string finds nothing at all.
  const byStreetLine = new Map([['18834 SANTA MARIA PKWY', parcelRecord]])

  it('prefers the parcel centroid over the permit coordinate', () => {
    // The permit point for anything pre-2016 came from a geocoder interpolating
    // along a street. The parcel centroid is the polygon the parish drew around
    // the house.
    const [candidate] = candidatesFromPermits([located], byStreetLine)
    expect(candidate?.latitude).toBeCloseTo(30.343521, 5)
    expect(candidate?.longitude).toBeCloseTo(-91.005993, 5)
    expect(candidate?.parcel?.ownerName).toBe('MANCUSO, WILLIAM DAVID')
  })

  it('keeps the door when the parcel roll has no such address', () => {
    // About one candidate in seven is genuinely absent from the roll. A door
    // with no name on it is still a door worth knocking.
    const [candidate] = candidatesFromPermits([located], new Map())
    expect(candidate).toBeDefined()
    expect(candidate?.parcel).toBeUndefined()
    expect(candidate?.latitude).toBe(30.3)
  })

  it('takes the subdivision from the assessor over the permit', () => {
    const [candidate] = candidatesFromPermits(
      [{ ...located, subdivision: 'STALE FROM PERMIT' }],
      byStreetLine,
    )
    expect(candidate?.subdivision).toBe('SANTA MARIA')
  })
})

describe('why this ranked', () => {
  it('itemises the score into parts that add up to it', () => {
    // A rep who adds the column and gets 83 under a headline of 84 stops
    // trusting the number, reasonably. The parts must sum to the whole.
    const { leads } = scoreLeads({
      candidates: [candidate()],
      storms: [storm()],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })

    const lead = leads[0]
    expect(lead).toBeDefined()
    const sum = (lead?.breakdown ?? []).reduce((t, f) => t + f.points, 0)
    expect(sum).toBe(lead?.score)
  })

  it('names each factor in words a rep can repeat', () => {
    const { leads } = scoreLeads({
      candidates: [candidate()],
      storms: [storm()],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })
    const labels = (leads[0]?.breakdown ?? []).map((f) => f.label)
    expect(labels).toEqual(['Hail size', 'Storm recency', 'Close to the report', 'Roof age'])
    for (const factor of leads[0]?.breakdown ?? []) {
      expect(factor.detail.length).toBeGreaterThan(3)
    }
  })
})

describe('roundToTotal', () => {
  it('gives the spare points to the largest remainders', () => {
    const rounded = roundToTotal(
      [
        { label: 'a', points: 10.6, detail: '' },
        { label: 'b', points: 10.6, detail: '' },
        { label: 'c', points: 10.1, detail: '' },
      ],
      32,
    )
    expect(rounded.map((f) => f.points)).toEqual([11, 11, 10])
    expect(rounded.reduce((t, f) => t + f.points, 0)).toBe(32)
  })
})

describe('the two terms the parcel roll made possible', () => {
  function withParcel(over: Record<string, unknown>) {
    return candidate({
      parcel: {
        externalId: 'ebr:1',
        provider: 'ebr',
        parcelNumber: '1',
        address: '19718 SOUTHERN HILLS AVE',
        addressKey: '19718 southern hills ave',
        parish: 'East Baton Rouge',
        ownerName: 'SMITH, JOHN',
        ownerKind: 'person',
        ownerConfidence: 'high',
        occupancy: 'owner_occupied',
        occupancyBasis: 'homestead_exemption',
        retrievedAt: '2026-09-23T00:00:00.000Z',
        ...over,
      },
    } as Parameters<typeof candidate>[0])
  }

  function scoreOf(c: LeadCandidate): number {
    const { leads } = scoreLeads({
      candidates: [c],
      storms: [storm()],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })
    return leads[0]?.score ?? -1
  }

  it('ranks the bigger job above the smaller one', () => {
    // The reason this term exists: across a real 150-door list the scores sat
    // in a band of 33 to 44, because roof age, hail size and recency are all
    // near-constant by construction — the candidate filter already required an
    // old roof under a storm. Assessed value spanned $12,100 to $584,248 and
    // the score was ignoring it.
    expect(scoreOf(withParcel({ assessedValue: 120_000 }))).toBeGreaterThan(
      scoreOf(withParcel({ assessedValue: 14_000 })),
    )
  })

  it('ranks an owner-occupied door above a likely rental', () => {
    expect(
      scoreOf(withParcel({ occupancy: 'owner_occupied', occupancyBasis: 'homestead_exemption' })),
    ).toBeGreaterThan(
      scoreOf(withParcel({ occupancy: 'likely_absentee', occupancyBasis: 'mailing_differs' })),
    )
  })

  it('does not punish a door the assessor simply does not list', () => {
    // An unknown job size is not a small one. Scoring it as zero would rank
    // every address the parish happens not to carry below every address it
    // does — a ranking of our data coverage, not of the opportunity.
    const unknown = scoreOf(candidate())
    const worst = scoreOf(withParcel({ assessedValue: 10_000, occupancy: 'likely_absentee', occupancyBasis: 'mailing_differs' }))
    expect(unknown).toBeGreaterThan(worst)
  })

  it('keeps the score out of the same 100 either way', () => {
    // Renormalisation means a door with no parcel is scored on the terms that
    // applied, not diluted by the ones that could not.
    const { leads } = scoreLeads({
      candidates: [candidate(), withParcel({ assessedValue: 27_870 })],
      storms: [storm()],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })
    for (const lead of leads) {
      expect(lead.score).toBeGreaterThanOrEqual(0)
      expect(lead.score).toBeLessThanOrEqual(100)
      expect(lead.breakdown.reduce((t, f) => t + f.points, 0)).toBe(lead.score)
    }
  })

  it('leaves a term it could not measure off the breakdown entirely', () => {
    const { leads } = scoreLeads({
      candidates: [candidate()],
      storms: [storm()],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })
    const labels = (leads[0]?.breakdown ?? []).map((f) => f.label)
    expect(labels).not.toContain('Job size')
    expect(labels).not.toContain('Owner occupied')
    expect(labels).toContain('Hail size')
  })

  it('names the job size in dollars a rep can repeat', () => {
    const { leads } = scoreLeads({
      candidates: [withParcel({ assessedValue: 133_270 })],
      storms: [storm()],
      reroofPermits: [],
      minHailInches: 1,
      radiusMiles: 3,
      now: NOW,
    })
    const factor = leads[0]?.breakdown.find((f) => f.label === 'Job size')
    expect(factor?.detail).toBe('assessed at $133,270')
  })
})
