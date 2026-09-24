import { describe, expect, it } from 'vitest'
import { coverageGaps, coverageTotals, type CoverageRow } from '@/features/manager/coverage'

/**
 * Route coverage against door coverage.
 *
 * The rule under test: going past a house is not knocking it, and the two must
 * never collapse into one "covered" number. Everything else here is arithmetic;
 * this is the part that decides whether a rep can be credited for driving down
 * a street.
 */

function row(overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    subdivision: 'Quail Ridge',
    doorsAvailable: 80,
    doorsPassed: 64,
    doorsKnocked: 12,
    appointments: 2,
    ...overrides,
  }
}

describe('coverage gaps', () => {
  /**
   * The sentence the whole feature exists to produce: went past 64, knocked 12.
   */
  it('separates passed-but-not-knocked from never-went-near', () => {
    const [gap] = coverageGaps([row()])
    expect(gap?.passedNotKnocked).toBe(52)
    expect(gap?.untouched).toBe(16)
  })

  /**
   * They call for opposite responses - one is work on a street already paid
   * for, the other is a routing decision nobody made - so they never merge.
   */
  it('does not add the two kinds of not-done together', () => {
    const [gap] = coverageGaps([row()])
    expect(gap!.passedNotKnocked + gap!.untouched).toBe(68)
    expect(gap?.passedNotKnocked).not.toBe(68)
  })

  it('reports the work rate against what was passed, not what exists', () => {
    const [gap] = coverageGaps([row()])
    // 12 of the 64 they actually reached, not 12 of 80.
    expect(gap?.workRate).toBeCloseTo(12 / 64)
  })

  /** Same rule as the funnel: 0 of 0 is a question nobody asked. */
  it('gives no work rate where nothing was passed', () => {
    const [gap] = coverageGaps([row({ doorsPassed: 0, doorsKnocked: 0 })])
    expect(gap?.workRate).toBeNull()
  })

  it('never reports a negative gap when knocks exceed the passed count', () => {
    // Possible in real data: a door knocked from a car park, or a fix dropped.
    const [gap] = coverageGaps([row({ doorsPassed: 5, doorsKnocked: 9 })])
    expect(gap?.passedNotKnocked).toBe(0)
  })

  it('puts the biggest cheap opportunity first', () => {
    const gaps = coverageGaps([
      row({ subdivision: 'Small', doorsAvailable: 10, doorsPassed: 8, doorsKnocked: 7 }),
      row({ subdivision: 'Big', doorsAvailable: 200, doorsPassed: 180, doorsKnocked: 20 }),
    ])
    expect(gaps[0]?.subdivision).toBe('Big')
  })

  /**
   * A neighbourhood the team drove through without knocking anything is the
   * clearest possible signal, and must not read as untouched.
   */
  it('shows a street driven through but never worked as passed, not untouched', () => {
    const [gap] = coverageGaps([row({ doorsAvailable: 40, doorsPassed: 40, doorsKnocked: 0 })])
    expect(gap?.passedNotKnocked).toBe(40)
    expect(gap?.untouched).toBe(0)
    expect(gap?.workRate).toBe(0)
  })
})

describe('totals', () => {
  const rows = [
    row({ subdivision: 'Tiny', doorsAvailable: 3, doorsPassed: 3, doorsKnocked: 3 }),
    row({ subdivision: 'Estate', doorsAvailable: 300, doorsPassed: 300, doorsKnocked: 60 }),
  ]

  /**
   * Summed, never averaged. Averaging per-subdivision percentages weights a
   * three-door street the same as a three-hundred-door estate, which is how a
   * dashboard reports 60% coverage of a parish nobody has finished.
   */
  it('sums rather than averaging percentages', () => {
    const totals = coverageTotals(rows)
    expect(totals.knocked).toBe(63)
    expect(totals.passed).toBe(303)
    expect(totals.workRate).toBeCloseTo(63 / 303)
    // The naive average of 100% and 20% would be 60%.
    expect(totals.workRate).toBeLessThan(0.3)
  })

  it('has no rate at all with nothing passed', () => {
    expect(coverageTotals([]).workRate).toBeNull()
  })
})
