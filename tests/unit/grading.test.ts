import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  DEFAULT_WEIGHTS,
  ENGINE,
  NEVER_GRADED_ON,
  effectiveGrade,
  gradeRep,
  letterFor,
  relativeScore,
  type StoredGrade,
  type TeamContext,
} from '@/features/manager/grading'
import { DEFAULT_FLOORS, performanceFor, pooled, rate } from '@/features/manager/performance'
import type { AssignedLead } from '@/features/manager/performance'
import type { ActivityRow, RouteRow } from '@/features/manager/metrics'

/**
 * A grade is a claim about somebody's livelihood. Most of what follows checks
 * that the engine declines to make one rather than that it makes a good one.
 */

const TEAM_OK = (value: number) => ({ value, reps: 4, unavailable: null })
const TEAM_NONE = { value: null, reps: 1, unavailable: 'The team has no rate yet.' }

const FULL_TEAM: TeamContext = {
  contactRate: TEAM_OK(0.3),
  appointmentRate: TEAM_OK(0.4),
  inspectionRate: TEAM_OK(0.5),
  contractRate: TEAM_OK(0.25),
  followUpRate: TEAM_OK(0.8),
  knocksPerHour: TEAM_OK(9),
  verifiedPerHour: TEAM_OK(8),
  routeCompletion: TEAM_OK(0.85),
}

function activity(n: number, opts: Partial<ActivityRow> = {}): ActivityRow[] {
  return Array.from({ length: n }, (_, i) => ({
    userId: 'rep-1',
    activityType: 'door_knock',
    outcome: 'spoke',
    gpsVerification: 'verified',
    occurredAt: new Date(Date.parse('2026-09-01T14:00:00Z') + i * 60_000).toISOString(),
    subdivision: 'SANTA MARIA',
    address: `${18800 + i} SANTA MARIA DR`,
    leadClientId: `lead-${i}`,
    ...opts,
  }))
}

function route(hours: number, index = 0): RouteRow {
  const start = Date.parse('2026-09-01T13:00:00Z') + index * 86_400_000
  return {
    id: `r-${index}`,
    userId: 'rep-1',
    label: null,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + hours * 3_600_000).toISOString(),
    pointCount: 120,
    firstFixAt: new Date(start).toISOString(),
    lastFixAt: new Date(start + hours * 3_600_000).toISOString(),
    pauses: [],
    latitude: 30.4,
    longitude: -91.1,
    accuracyM: 8,
  }
}

function assigned(n: number, status: string, score = 60): AssignedLead[] {
  return Array.from({ length: n }, (_, i) => ({
    repId: 'rep-1',
    leadClientId: `lead-${i}`,
    scoreAtAssignment: score,
    assignedAt: '2026-09-01T12:00:00Z',
    status,
    nextActionAt: null,
    lastActivityAt: null,
    subdivision: 'SANTA MARIA',
  }))
}

const WINDOW = { from: '2026-09-01T00:00:00Z', to: '2026-09-30T23:59:59Z' }

describe('the scale', () => {
  it('puts a rep who matches the team on a B, not a C', () => {
    // A scale where the average of a functioning team reads as below par is a
    // scale everybody learns to ignore.
    expect(relativeScore(0.3, 0.3)).toBe(70)
    expect(letterFor(70, DEFAULT_CONFIG.scale)).toBe('B')
  })

  it('caps the top at twice the team rate', () => {
    // Five times the team rate is a sample problem, not an A++.
    expect(relativeScore(0.6, 0.3)).toBe(100)
    expect(relativeScore(1.5, 0.3)).toBe(100)
  })

  it('falls in proportion below the team rate', () => {
    expect(relativeScore(0.15, 0.3)).toBe(35)
    expect(relativeScore(0, 0.3)).toBe(0)
  })

  it('refuses to punish anybody when the team has no rate', () => {
    expect(relativeScore(0.5, 0)).toBe(70)
  })
})

describe('what it will not grade on', () => {
  it('keeps the banned inputs out of the weights', () => {
    const keys = Object.keys(DEFAULT_WEIGHTS).join(' ')
    for (const banned of ['miles', 'distance', 'duration', 'timer', 'samples', 'leads_received']) {
      expect(keys).not.toContain(banned)
    }
    expect(NEVER_GRADED_ON.length).toBeGreaterThan(0)
  })

  it('adds up to a hundred out of the box', () => {
    expect(Object.values(DEFAULT_WEIGHTS).reduce((t, w) => t + w, 0)).toBe(100)
  })
})

describe('a thin window', () => {
  it('produces no grade at all rather than a confident one', () => {
    const performance = performanceFor({
      repId: 'rep-1',
      ...WINDOW,
      activity: activity(2),
      routes: [],
      assignments: [],
      baseline: [],
    })
    const grade = gradeRep(performance, FULL_TEAM)
    expect(grade.score).toBeNull()
    expect(grade.letter).toBeNull()
    expect(grade.unavailable).toMatch(/could be scored/i)
    expect(grade.confidence).toBe(0)
  })

  it('never turns one contract out of two leads into a 50% close rate', () => {
    const performance = performanceFor({
      repId: 'rep-1',
      ...WINDOW,
      activity: activity(2),
      routes: [route(4)],
      assignments: [...assigned(1, 'sold'), ...assigned(1, 'inspected')],
      baseline: [],
    })
    expect(performance.sales.contractRate.value).toBeNull()
    expect(performance.sales.contractRate.unavailable).toMatch(/at least/i)
  })
})

describe('a full window', () => {
  const performance = performanceFor({
    repId: 'rep-1',
    ...WINDOW,
    activity: [
      ...activity(60),
      ...activity(20, { activityType: 'appointment', outcome: null }),
    ],
    routes: [route(6, 0), route(6, 1), route(6, 2)],
    assignments: [
      ...assigned(30, 'sold'),
      ...assigned(30, 'inspected'),
      ...assigned(20, 'not_interested'),
    ],
    baseline: [{ band: 4, label: '60+', decided: 100, won: 25, rate: 0.25 }],
  })

  it('scores, and shows every term it used', () => {
    const grade = gradeRep(performance, FULL_TEAM)
    expect(grade.engine).toBe(ENGINE)
    expect(grade.score).not.toBeNull()
    expect(grade.letter).not.toBeNull()
    for (const category of grade.categories) {
      expect(category.evidence.length).toBeGreaterThan(10)
      expect(category.weight).toBeGreaterThan(0)
    }
  })

  it('drops an unscorable category from the denominator instead of guessing it', () => {
    const noTeamRate = gradeRep(performance, { ...FULL_TEAM, contractRate: TEAM_NONE })
    const full = gradeRep(performance, FULL_TEAM)
    expect(noTeamRate.coverage).toBeLessThan(full.coverage)
    // Confidence falls by exactly the weight that was removed, times the rest.
    expect(noTeamRate.confidence).toBeLessThan(full.confidence)
    const dropped = noTeamRate.categories.find((c) => c.key === 'contract_conversion')
    expect(dropped?.score).toBeNull()
    expect(dropped?.unavailable).toMatch(/team has no rate/i)
  })

  it('reports low confidence rather than hiding it', () => {
    const thin = gradeRep(performance, {
      ...FULL_TEAM,
      contractRate: TEAM_NONE,
      inspectionRate: TEAM_NONE,
      followUpRate: TEAM_NONE,
      appointmentRate: TEAM_NONE,
    })
    expect(thin.lowConfidence).toBe(true)
    expect(thin.confidence).toBeLessThan(DEFAULT_CONFIG.minConfidence)
  })

  it('names something to actually do when a category is weak', () => {
    const weak = gradeRep(performance, { ...FULL_TEAM, contactRate: TEAM_OK(0.9) })
    expect(weak.weaknesses.length).toBeGreaterThan(0)
    expect(weak.coaching.length).toBeGreaterThan(0)
    expect(weak.coaching.join(' ')).not.toMatch(/keep up the good work/i)
  })
})

describe('lead quality', () => {
  it('does not call the rep with better doors the better rep by default', () => {
    // Same raw contract count, very different streets. The efficiency index is
    // the only category that holds quality constant, and it is what
    // lead_utilisation scores on.
    const baseline = [
      { band: 4, label: '60+', decided: 200, won: 40, rate: 0.2 },
      { band: 1, label: '30–39', decided: 200, won: 10, rate: 0.05 },
    ]
    const good = performanceFor({
      repId: 'rep-1',
      ...WINDOW,
      activity: [],
      routes: [],
      assignments: [...assigned(20, 'sold', 70), ...assigned(20, 'lost', 70)],
      baseline,
    })
    const rough = performanceFor({
      repId: 'rep-1',
      ...WINDOW,
      activity: [],
      routes: [],
      assignments: [...assigned(20, 'sold', 35), ...assigned(20, 'lost', 35)],
      baseline,
    })
    expect(good.quality.averageScore).toBe(70)
    expect(rough.quality.averageScore).toBe(35)
    // Identical raw results; the rough streets are worth far more.
    expect(rough.quality.efficiency.index as number).toBeGreaterThan(
      good.quality.efficiency.index as number,
    )
  })
})

describe('whose grade it is', () => {
  const base: StoredGrade = {
    repId: 'rep-1',
    periodStart: WINDOW.from,
    periodEnd: WINDOW.to,
    period: 'monthly',
    mode: 'assisted',
    computed: { ...gradeRep(
      performanceFor({
        repId: 'rep-1',
        ...WINDOW,
        activity: activity(60),
        routes: [route(6, 0), route(6, 1), route(6, 2)],
        assignments: assigned(60, 'sold'),
        baseline: [{ band: 4, label: '60+', decided: 100, won: 25, rate: 0.25 }],
      }),
      FULL_TEAM,
    ) },
    managerLetter: null,
    managerComment: null,
    managerOverrideReason: null,
    managerCategoryScores: null,
    gradedBy: null,
    gradedAt: null,
  }

  it('is nobody’s grade in assisted mode until a manager says so', () => {
    const result = effectiveGrade(base, { ...DEFAULT_CONFIG, mode: 'assisted' })
    expect(result.letter).toBeNull()
    expect(result.source).toBe('none')
    expect(result.note).toMatch(/suggestion/i)
  })

  it('is never computed in manual mode, however confident', () => {
    const result = effectiveGrade(base, { ...DEFAULT_CONFIG, mode: 'manual' })
    expect(result.source).toBe('none')
    expect(result.note).toMatch(/manual/i)
  })

  it('stands on its own in automatic mode when approval is not required', () => {
    const result = effectiveGrade(base, {
      ...DEFAULT_CONFIG,
      mode: 'automatic',
      managerApprovalRequired: false,
    })
    expect(result.source).toBe('computed')
    expect(result.letter).toBe(base.computed?.letter)
  })

  it('keeps the computed grade alongside a manager override', () => {
    const overridden: StoredGrade = {
      ...base,
      managerLetter: 'A-',
      managerOverrideReason: 'Underweighted the commercial referrals this month.',
    }
    const result = effectiveGrade(overridden, DEFAULT_CONFIG)
    expect(result.letter).toBe('A-')
    expect(result.source).toBe('manager')
    // The question a year from now is whether the manager agreed with the
    // rubric, and that is unanswerable if accepting overwrote it.
    expect(overridden.computed?.letter).toBeTruthy()
  })
})

describe('team rates', () => {
  it('pools rather than averaging per-rep rates', () => {
    // Averaging lets a rep with four doors count as much as one with four
    // hundred, which makes a baseline mostly noise from whoever knocked least.
    const busy = rate(30, 100, 10, 'knocks')
    const quiet = rate(1, 4, 1, 'knocks')
    const team = pooled([busy, quiet], 10, 'knocks')
    expect(team.value).toBeCloseTo(31 / 104)
    expect(team.value).not.toBeCloseTo((0.3 + 0.25) / 2)
  })

  it('refuses a team rate built on nothing', () => {
    expect(pooled([rate(1, 3, 10, 'knocks')], 10, 'knocks').value).toBeNull()
  })
})

describe('sample floors', () => {
  it('are stated, not buried', () => {
    expect(DEFAULT_FLOORS.inspectionsForContractRate).toBeGreaterThan(1)
    expect(DEFAULT_FLOORS.knocksForContactRate).toBeGreaterThan(10)
  })
})
