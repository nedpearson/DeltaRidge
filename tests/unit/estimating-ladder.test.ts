import { describe, expect, it } from 'vitest'
import { buildEstimate } from '@/features/estimating/build'
import { DEFAULT_MARGINS, type CostSheet } from '@/features/estimating/store'
import { describePricing } from '@/features/estimating/cost'
import { ratesFrom } from '@/features/estimating/store'
import { percentToBps } from '@/features/estimating/money'
import { marginOf } from '@/features/estimating/margin'
import type { RoofGeometry } from '@/features/estimating/geometry'

const GEOMETRY: RoofGeometry = {
  facets: [{ id: 'a', areaSqFt: 3_200, pitch: { rise: 6 } }],
  ridgeLf: 40, hipLf: 0, valleyLf: 0, eaveLf: 80, rakeLf: 60,
  stepFlashingLf: 0, wallFlashingLf: 0,
  penetrations: [{ kind: 'pipe_boot', count: 3 }],
  stories: 1, eaveHeightFt: 10, existingLayers: 1, unknowns: [],
}

const COSTS: CostSheet = {
  shingle_sq: 120, underlayment_sq: 18, starter_lf: 1.35, cap_lf: 2.6,
  drip_edge_lf: 1.15, pipe_boot_ea: 14, tear_off_sq: 45, install_sq: 95,
  disposal_job: 650, permit_job: 150,
}

/**
 * Every negotiation rung must mean what it says AFTER commission.
 *
 * The first version laddered the rungs off job cost with priceLadder(), which
 * ignores price-linked costs, while the recommended price was solved with
 * commission included. On one screen the two disagreed by thousands: the
 * "manager floor" showed a price that actually yields far less than the
 * margin printed beside it, and a rep would discount straight through the
 * floor believing they were inside it.
 */
describe('negotiation rungs are commission-aware', () => {
  const built = buildEstimate(GEOMETRY, COSTS, DEFAULT_MARGINS)
  const rates = ratesFrom(DEFAULT_MARGINS)

  it('has a non-zero commission, or this test proves nothing', () => {
    expect(DEFAULT_MARGINS.commissionPercent).toBeGreaterThan(0)
    expect(built.recommended.commission).toBeGreaterThan(0)
  })

  it('each rung yields the margin it is labelled with, after commission', () => {
    const cases: Array<[keyof typeof built.ladder, number]> = [
      ['standard', DEFAULT_MARGINS.standardPercent],
      ['target', DEFAULT_MARGINS.targetPercent],
      ['floor', DEFAULT_MARGINS.floorPercent],
      ['stop', DEFAULT_MARGINS.stopPercent],
    ]
    for (const [rung, percent] of cases) {
      const realised = describePricing(built.ladder[rung], built.jobCost, rates).realisedMargin
      expect(realised).toBe(percentToBps(percent))
    }
  })

  it('the recommended price IS the standard rung', () => {
    expect(built.recommended.price).toBe(built.ladder.standard)
  })

  it('still descends', () => {
    expect(built.ladder.standard).toBeGreaterThan(built.ladder.target)
    expect(built.ladder.target).toBeGreaterThan(built.ladder.floor)
    expect(built.ladder.floor).toBeGreaterThan(built.ladder.stop)
  })

  it('every rung sits above the naive commission-free price', () => {
    // The old, wrong rungs. Each real rung must be higher, because commission
    // has to come out of the price and still leave the stated margin.
    for (const rung of ['standard', 'target', 'floor', 'stop'] as const) {
      const naiveMargin = marginOf(built.ladder[rung], built.jobCost)
      expect(naiveMargin).toBeGreaterThan(
        percentToBps(DEFAULT_MARGINS[`${rung}Percent` as const]),
      )
    }
  })
})


