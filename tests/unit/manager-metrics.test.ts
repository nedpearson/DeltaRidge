import { describe, expect, it } from 'vitest'
import {
  COMFORTABLE_OPEN_ASSIGNMENTS,
  MIN_DECIDED_PER_BAND,
  MIN_DECIDED_PER_REP,
  MIN_USABLE_FIXES,
  activeRoutes,
  bandOf,
  efficiencyFor,
  fixFreshness,
  orgBaseline,
  rollUpActivity,
  suggestAssignees,
  territoryCoverage,
  type ActivityRow,
  type AssignmentOutcome,
  type RepContext,
  type RouteRow,
} from '@/features/manager/metrics'

/**
 * These numbers get quoted in conversations about people's jobs. Every test
 * here is about a way the arithmetic could be confidently wrong.
 */

function outcome(repId: string, score: number, status: string): AssignmentOutcome {
  return { repId, scoreAtAssignment: score, status }
}

function many(n: number, fn: (i: number) => AssignmentOutcome): AssignmentOutcome[] {
  return Array.from({ length: n }, (_, i) => fn(i))
}

describe('bandOf', () => {
  it('puts a score in the band its edge says', () => {
    expect(bandOf(0)).toBe(0)
    expect(bandOf(29)).toBe(0)
    expect(bandOf(30)).toBe(1)
    expect(bandOf(59)).toBe(3)
    expect(bandOf(100)).toBe(4)
  })
})

describe('orgBaseline', () => {
  it('reports no rate for a band with too little history', () => {
    // A 50% conversion computed from four doors is noise wearing a number's
    // clothes, and it would become the yardstick every rep is measured against.
    const rates = orgBaseline(many(4, (i) => outcome('a', 45, i < 2 ? 'sold' : 'lost')))
    expect(rates[0]?.rate).toBeNull()
    expect(rates[0]?.decided).toBe(4)
  })

  it('reports a rate once a band has enough decided doors', () => {
    const n = MIN_DECIDED_PER_BAND
    const rates = orgBaseline(many(n, (i) => outcome('a', 45, i < n / 2 ? 'sold' : 'lost')))
    expect(rates[0]?.rate).toBeCloseTo(0.5, 1)
  })

  it('ignores leads that have not been decided yet', () => {
    const rates = orgBaseline([
      outcome('a', 45, 'sold'),
      outcome('a', 45, 'appointment'),
      outcome('a', 45, 'no_answer'),
    ])
    expect(rates[0]?.decided).toBe(1)
  })

  it('counts only sold as won', () => {
    // 'inspected' and 'appointment' are progress, not revenue. Counting them
    // would inflate every rep and every baseline together, which reads as
    // success and measures nothing.
    const rates = orgBaseline([
      outcome('a', 45, 'sold'),
      outcome('a', 45, 'lost'),
      outcome('a', 45, 'not_interested'),
    ])
    expect(rates[0]?.won).toBe(1)
  })
})

describe('efficiencyFor', () => {
  it('refuses an index for a rep with too few decided doors', () => {
    const outcomes = many(5, () => outcome('anna', 45, 'sold'))
    const result = efficiencyFor('anna', outcomes, orgBaseline(outcomes))
    expect(result.index).toBeNull()
    expect(result.unavailable).toContain(String(MIN_DECIDED_PER_REP))
  })

  it('scores a rep at par when they match the team rate', () => {
    // 40 doors in one band, half sold. Anna has 20 of them and sold 10, which
    // is exactly what those doors were worth.
    const outcomes = [
      ...many(20, (i) => outcome('anna', 45, i < 10 ? 'sold' : 'lost')),
      ...many(20, (i) => outcome('ben', 45, i < 10 ? 'sold' : 'lost')),
    ]
    const result = efficiencyFor('anna', outcomes, orgBaseline(outcomes))
    expect(result.index).toBeCloseTo(1, 2)
  })

  it('does not reward a rep for being handed better doors', () => {
    // The whole reason the score is frozen at assignment. Ben closes more in
    // absolute terms, but only because every door he was given was a good one.
    const outcomes = [
      // Weak band: team converts 20%.
      ...many(20, (i) => outcome('anna', 35, i < 4 ? 'sold' : 'lost')),
      ...many(20, (i) => outcome('carla', 35, i < 4 ? 'sold' : 'lost')),
      // Strong band: team converts 60%.
      ...many(20, (i) => outcome('ben', 75, i < 12 ? 'sold' : 'lost')),
      ...many(20, (i) => outcome('carla', 75, i < 12 ? 'sold' : 'lost')),
    ]
    const baseline = orgBaseline(outcomes)
    const anna = efficiencyFor('anna', outcomes, baseline)
    const ben = efficiencyFor('ben', outcomes, baseline)

    expect(anna.won).toBe(4)
    expect(ben.won).toBe(12)
    // Three times the contracts, identical performance against what they were given.
    expect(anna.index).toBeCloseTo(ben.index ?? 0, 2)
  })

  it('shows the arithmetic band by band', () => {
    const outcomes = many(30, (i) => outcome('anna', i < 15 ? 35 : 75, i % 2 === 0 ? 'sold' : 'lost'))
    const result = efficiencyFor('anna', outcomes, orgBaseline(outcomes))
    // A manager has to be able to put this in front of the rep.
    expect(result.contributions.length).toBeGreaterThan(1)
    for (const c of result.contributions) expect(c.decided).toBeGreaterThan(0)
  })

  it('leaves out bands the team has no rate for rather than inventing one', () => {
    const outcomes = [
      ...many(20, (i) => outcome('anna', 45, i < 10 ? 'sold' : 'lost')),
      // Three doors in a band nobody else has worked.
      ...many(3, () => outcome('anna', 95, 'lost')),
    ]
    const result = efficiencyFor('anna', outcomes, orgBaseline(outcomes))
    const sparse = result.contributions.find((c) => c.label === '60+')
    expect(sparse?.teamRate).toBeNull()
    expect(sparse?.expected).toBeNull()
    // Those three losses must not drag the index down against an expectation
    // that was never measured.
    expect(result.index).toBeCloseTo(1, 2)
  })
})

describe('rollUpActivity', () => {
  function row(over: Partial<ActivityRow> = {}): ActivityRow {
    return {
      userId: 'anna',
      activityType: 'door_knock',
      outcome: 'no_answer',
      gpsVerification: 'verified',
      occurredAt: '2026-09-23T15:00:00.000Z',
      subdivision: 'Santa Maria',
      address: '18818 BELLA VISTA CT',
      leadClientId: 'lead-1',
      ...over,
    }
  }

  it('counts three knocks at one door as one door', () => {
    const rolled = rollUpActivity([row(), row(), row()])
    expect(rolled[0]?.knocks).toBe(3)
    expect(rolled[0]?.doors).toBe(1)
  })

  it('counts a conversation only when somebody came to the door', () => {
    const rolled = rollUpActivity([row(), row({ outcome: 'interested', leadClientId: 'lead-2' })])
    expect(rolled[0]?.conversations).toBe(1)
  })

  it('withholds the off-property share until there are enough usable fixes', () => {
    const rolled = rollUpActivity([row({ gpsVerification: 'unverified' })])
    expect(rolled[0]?.offPropertyShare).toBeNull()
  })

  it('excludes knocks with no fix from the off-property share', () => {
    // Otherwise whoever works the neighbourhood with bad reception looks worst.
    const rows = [
      ...Array.from({ length: MIN_USABLE_FIXES }, () => row({ gpsVerification: 'verified' })),
      ...Array.from({ length: 50 }, () => row({ gpsVerification: null })),
    ]
    expect(rollUpActivity(rows)[0]?.offPropertyShare).toBe(0)
  })

  it('keeps unattributed work visible rather than dropping it', () => {
    const rolled = rollUpActivity([row({ userId: null })])
    expect(rolled[0]?.repId).toBe('unattributed')
  })
})

describe('territoryCoverage', () => {
  const doors = [
    { subdivision: 'Santa Maria', score: 44 },
    { subdivision: 'Santa Maria', score: 40 },
    { subdivision: 'Willowbrook', score: 38 },
  ]

  function knock(subdivision: string, leadClientId: string): ActivityRow {
    return {
      userId: 'anna',
      activityType: 'door_knock',
      outcome: 'no_answer',
      gpsVerification: 'verified',
      occurredAt: '2026-09-23T15:00:00.000Z',
      subdivision,
      address: `${leadClientId} ${subdivision}`,
      leadClientId,
    }
  }

  it('measures knocked against available', () => {
    const rows = territoryCoverage(doors, [knock('Santa Maria', 'a')])
    expect(rows.find((r) => r.subdivision === 'Santa Maria')?.share).toBeCloseTo(0.5, 2)
  })

  it('never reports a neighbourhood with an unknown total as covered', () => {
    // The most confidently wrong number a dashboard can print: 100% from an
    // empty denominator.
    const rows = territoryCoverage([], [knock('Shadowbrook', 'a')])
    const row = rows.find((r) => r.subdivision === 'Shadowbrook')
    expect(row?.available).toBe(0)
    expect(row?.share).toBe(0)
  })

  it('counts a door knocked twice once', () => {
    const rows = territoryCoverage(doors, [knock('Santa Maria', 'a'), knock('Santa Maria', 'a')])
    expect(rows.find((r) => r.subdivision === 'Santa Maria')?.knocked).toBe(1)
  })

  it('cannot exceed full coverage', () => {
    const rows = territoryCoverage(doors, [
      knock('Willowbrook', 'a'),
      knock('Willowbrook', 'b'),
      knock('Willowbrook', 'c'),
    ])
    expect(rows.find((r) => r.subdivision === 'Willowbrook')?.share).toBe(1)
  })
})

describe('suggestAssignees', () => {
  function rep(over: Partial<RepContext> = {}): RepContext {
    return {
      repId: 'anna',
      openAssignments: 5,
      workedSubdivisions: new Set<string>(),
      efficiency: null,
      ...over,
    }
  }

  it('prefers a rep already working that neighbourhood', () => {
    const [first] = suggestAssignees({ subdivision: 'Santa Maria', score: 44 }, [
      rep({ repId: 'ben' }),
      rep({ repId: 'anna', workedSubdivisions: new Set(['Santa Maria']) }),
    ])
    expect(first?.repId).toBe('anna')
  })

  it('marks a stretched rep as stretched instead of silently ranking them lower', () => {
    const [suggestion] = suggestAssignees({ score: 44 }, [
      rep({ openAssignments: COMFORTABLE_OPEN_ASSIGNMENTS + 20 }),
    ])
    const factor = suggestion?.factors.find((f) => f.label === 'Already stretched')
    expect(factor).toBeDefined()
    expect(factor?.weight).toBeLessThan(0)
  })

  it('never penalises a rep for having no index yet', () => {
    const [suggestion] = suggestAssignees({ score: 44 }, [rep({ efficiency: null })])
    const factor = suggestion?.factors.find((f) => f.label === 'No index yet')
    expect(factor?.weight).toBe(0)
  })

  it('keeps efficiency a small term', () => {
    // Giving the best doors to whoever already converts best is how a team ends
    // up with one rep who looks excellent and three who never got a chance.
    const [suggestion] = suggestAssignees({ score: 44 }, [rep({ efficiency: 5 })])
    const factor = suggestion?.factors.find((f) => f.label.includes('Converting'))
    expect(Math.abs(factor?.weight ?? 0)).toBeLessThanOrEqual(15)
  })

  it('explains every term it used', () => {
    const [suggestion] = suggestAssignees({ subdivision: 'Santa Maria', score: 44 }, [
      rep({ workedSubdivisions: new Set(['Santa Maria']), efficiency: 1.2 }),
    ])
    expect(suggestion?.factors.length).toBeGreaterThanOrEqual(3)
    for (const f of suggestion?.factors ?? []) expect(f.detail.length).toBeGreaterThan(0)
  })
})

describe('the live field view', () => {
  function route(over: Partial<RouteRow> = {}): RouteRow {
    return {
      id: 'r1',
      userId: 'anna',
      label: null,
      startedAt: '2026-09-23T14:00:00.000Z',
      endedAt: null,
      pointCount: 10,
      firstFixAt: '2026-09-23T14:00:00.000Z',
      lastFixAt: '2026-09-23T15:00:00.000Z',
      pauses: [],
      latitude: 30.45,
      longitude: -91.18,
      accuracyM: 12,
      ...over,
    }
  }

  it('shows only routes the rep has not stopped', () => {
    // A manager watching where somebody is after they finished work is not a
    // status board.
    const rows = activeRoutes([route(), route({ id: 'r2', endedAt: '2026-09-23T17:00:00.000Z' })])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('r1')
  })

  it('calls a fresh fix live and an old one stale', () => {
    const now = Date.parse('2026-09-23T15:00:00.000Z')
    expect(fixFreshness('2026-09-23T14:59:30.000Z', now)).toBe('live')
    expect(fixFreshness('2026-09-23T14:55:00.000Z', now)).toBe('recent')
    expect(fixFreshness('2026-09-23T14:30:00.000Z', now)).toBe('stale')
    expect(fixFreshness(null, now)).toBe('none')
  })
})
