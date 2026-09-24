import { describe, expect, it } from 'vitest'
import { MISSING_SEGMENTS, byScoreBand, bySubdivision, standout } from '@/features/manager/segments'
import { MEANINGFUL_CHANGE, summarise, trendOf } from '@/features/manager/trends'
import { rate } from '@/features/manager/performance'
import type { AssignedLead } from '@/features/manager/performance'

function lead(status: string, score: number, subdivision: string | null): AssignedLead {
  return {
    repId: 'rep-1',
    leadClientId: Math.random().toString(36),
    scoreAtAssignment: score,
    assignedAt: '2026-09-01T12:00:00Z',
    status,
    nextActionAt: null,
    lastActivityAt: null,
    subdivision,
  }
}

function many(n: number, status: string, score: number, subdivision: string | null) {
  return Array.from({ length: n }, () => lead(status, score, subdivision))
}

describe('segments', () => {
  it('names the splits it cannot make instead of faking them', () => {
    // "Insurance hail versus retail" is what a roofing manager actually wants
    // and nothing in the schema records it.
    expect(MISSING_SEGMENTS.map((s) => s.name)).toContain('Insurance claim against retail')
    for (const missing of MISSING_SEGMENTS) expect(missing.needs.length).toBeGreaterThan(20)
  })

  it('withholds a rate for a thin segment', () => {
    const result = byScoreBand([...many(3, 'sold', 65, 'A'), ...many(2, 'lost', 65, 'A')])
    expect(result[0]?.rate).toBeNull()
    expect(result[0]?.unavailable).toMatch(/Needs 12/)
  })

  it('reports one when there is enough', () => {
    const result = byScoreBand([...many(6, 'sold', 65, 'A'), ...many(14, 'lost', 65, 'A')])
    expect(result[0]?.rate).toBeCloseTo(0.3)
  })

  it('skips leads with no neighbourhood rather than bucketing them as Unknown', () => {
    const result = bySubdivision([...many(20, 'sold', 65, null)])
    expect(result).toHaveLength(0)
  })

  it('refuses a "strongest and weakest" built on one segment', () => {
    const one = byScoreBand([...many(6, 'sold', 65, 'A'), ...many(14, 'lost', 65, 'A')])
    expect(standout(one).strongest).toBeNull()
  })
})

describe('trends', () => {
  it('will not compare when either window is too thin', () => {
    const t = trendOf('Contact rate', rate(1, 3, 40, 'knocks'), rate(20, 60, 40, 'knocks'))
    expect(t.direction).toBe('unknown')
    expect(t.change).toBeNull()
  })

  it('never prints a percentage off a zero baseline', () => {
    // This is how "up 300%" gets written about one extra sale.
    const t = trendOf('Contracts', rate(0, 50, 10, 'inspections'), rate(3, 50, 10, 'inspections'))
    expect(t.change).toBeNull()
    expect(t.note).toMatch(/counts instead/i)
  })

  it('calls a small move stable', () => {
    const t = trendOf('Contact rate', rate(30, 100, 40, 'knocks'), rate(32, 100, 40, 'knocks'))
    expect(t.direction).toBe('stable')
    expect(Math.abs(t.change as number)).toBeLessThan(MEANINGFUL_CHANGE)
  })

  it('names a real move with both denominators', () => {
    const t = trendOf('Contact rate', rate(20, 100, 40, 'knocks'), rate(40, 100, 40, 'knocks'))
    expect(t.direction).toBe('improving')
    expect(t.note).toMatch(/100 then against 100 now/)
  })

  it('does not average directions into one verdict', () => {
    const summary = summarise([
      trendOf('Appointments per hour', rate(20, 100, 40, 'knocks'), rate(40, 100, 40, 'knocks')),
      trendOf('Follow-up completion', rate(80, 100, 10, 'follow-ups'), rate(60, 100, 10, 'follow-ups')),
    ])
    expect(summary).toMatch(/improved while/)
    expect(summary).not.toMatch(/overall/i)
  })
})
