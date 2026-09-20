import { describe, expect, it } from 'vitest'
import { buildJobCost, type OverheadPolicy } from '@/features/estimating/cost'
import { dollarsToCents, percentToBps } from '@/features/estimating/money'

const overhead: OverheadPolicy = {
  rate: percentToBps(12),
  minimum: dollarsToCents(250),
}

/**
 * The overhead minimum exists so a small repair still carries its share of the
 * truck. It must not apply when there is no job.
 *
 * Caught by an estimate with no costs entered: it showed $250 of overhead and
 * then a confident selling price solved off that $250, which is a number for
 * work nobody had priced.
 */
describe('the overhead floor does not manufacture a job', () => {
  it('charges no overhead on an empty estimate', () => {
    const empty = buildJobCost([], overhead)
    expect(empty.directCost).toBe(0)
    expect(empty.overhead).toBe(0)
    expect(empty.total).toBe(0)
  })

  it('charges no overhead when every line is zero', () => {
    const zeroed = buildJobCost(
      [{ category: 'material', description: 'nothing', amount: dollarsToCents(0) }],
      overhead,
    )
    expect(zeroed.total).toBe(0)
  })

  it('still applies the floor to a small but real job', () => {
    const small = buildJobCost(
      [{ category: 'labor', description: 'repair', amount: dollarsToCents(400) }],
      overhead,
    )
    expect(small.overhead).toBe(dollarsToCents(250))
  })

  it('uses the rate once it exceeds the floor', () => {
    const big = buildJobCost(
      [{ category: 'material', description: 'shingles', amount: dollarsToCents(10_000) }],
      overhead,
    )
    expect(big.overhead).toBe(dollarsToCents(1_200))
  })
})
