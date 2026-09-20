import { describe, expect, it } from 'vitest'
import { dollarsToCents, dollarsToUnitPrice, percentToBps, bps } from '@/features/estimating/money'
import {
  buildJobCost,
  describePricing,
  solvePrice,
  NO_PRICE_LINKED_RATES,
  type JobCostLine,
  type OverheadPolicy,
  type PriceLinkedRates,
} from '@/features/estimating/cost'
import { priceFromMargin, marginOf } from '@/features/estimating/margin'
import {
  purchaseQuantityFor,
  extendPurchase,
  resolveMaterialPrice,
  type MaterialItem,
  type PriceBook,
} from '@/features/estimating/price-book'

const overhead: OverheadPolicy = { rate: percentToBps(12), minimum: dollarsToCents(250) }

const lines: readonly JobCostLine[] = [
  { category: 'material', description: 'shingles', amount: dollarsToCents(4_200) },
  { category: 'labor', description: 'install', amount: dollarsToCents(3_800) },
  { category: 'disposal', description: 'dumpster', amount: dollarsToCents(650) },
  { category: 'permit', description: 'EBR reroof permit', amount: dollarsToCents(150) },
]

describe('job cost', () => {
  it('sums direct cost and allocates overhead', () => {
    const cost = buildJobCost(lines, overhead)
    expect(cost.directCost).toBe(dollarsToCents(8_800))
    expect(cost.overhead).toBe(dollarsToCents(1_056))
    expect(cost.total).toBe(dollarsToCents(9_856))
  })

  it('applies the overhead floor on a small job', () => {
    const small = buildJobCost(
      [{ category: 'labor', description: 'repair', amount: dollarsToCents(400) }],
      overhead,
    )
    expect(small.overhead).toBe(dollarsToCents(250))
  })
})

describe('price-linked costs', () => {
  const rates: PriceLinkedRates = {
    commission: percentToBps(8),
    financingDealerFee: percentToBps(4.9),
    cardProcessing: bps(0),
  }
  const jobCost = dollarsToCents(12_100)

  it('leaves the target margin after commission and dealer fee', () => {
    const solved = solvePrice(jobCost, percentToBps(35), rates)
    expect(solved.realisedMargin).toBe(percentToBps(35))
    expect(solved.totalCost).toBeLessThan(solved.price)
  })

  it('shows the shortfall from pricing as if those costs were fixed', () => {
    const naive = priceFromMargin(jobCost, percentToBps(35))
    const actual = describePricing(naive, jobCost, rates)
    // The naive price nominally shows 35%; after commission and dealer fee it does not.
    expect(marginOf(naive, jobCost)).toBe(percentToBps(35))
    expect(actual.realisedMargin).toBeLessThan(percentToBps(23))
    expect(solvePrice(jobCost, percentToBps(35), rates).price).toBeGreaterThan(naive)
  })

  it('matches plain margin pricing when there are no price-linked costs', () => {
    const solved = solvePrice(jobCost, percentToBps(35), NO_PRICE_LINKED_RATES)
    expect(solved.price).toBe(priceFromMargin(jobCost, percentToBps(35)))
  })

  it('refuses a margin that leaves nothing to price against', () => {
    expect(() => solvePrice(jobCost, percentToBps(96), rates)).toThrow(RangeError)
  })
})

const shingle: MaterialItem = {
  id: 'shingle-arch-std',
  category: 'shingle',
  manufacturer: null,
  productFamily: null,
  sku: null,
  description: 'Architectural shingle',
  unit: 'BDL',
  coveragePerUnit: 33.33,
  saleIncrement: 1,
  impactRating: null,
  windRatingMph: 130,
  fortifiedEligible: true,
}

describe('purchase quantities', () => {
  it('rounds up to whole bundles and reports the overage', () => {
    const purchase = purchaseQuantityFor(shingle, 4_202)
    expect(purchase.purchaseUnits).toBe(127)
    expect(purchase.overageQuantity).toBeCloseTo(127 * 33.33 - 4_202, 2)
  })

  it('extends the purchase, not the scope quantity', () => {
    const purchase = purchaseQuantityFor(shingle, 4_202)
    expect(extendPurchase(purchase, dollarsToUnitPrice(38.75))).toBe(dollarsToCents(4_921.25))
  })

  it('respects a sale increment', () => {
    const byThree = purchaseQuantityFor({ ...shingle, saleIncrement: 3 }, 4_202)
    expect(byThree.purchaseUnits % 3).toBe(0)
    expect(byThree.purchaseUnits).toBe(129)
  })
})

describe('effective-dated pricing', () => {
  const book: PriceBook = {
    id: 'pb',
    version: '2026.09',
    materials: [shingle],
    materialPrices: [
      {
        materialItemId: shingle.id,
        supplierId: 'abc',
        unitCost: dollarsToUnitPrice(35.5),
        effectiveFrom: '2026-01-01',
        source: 'invoice',
        sourceReference: null,
      },
      {
        materialItemId: shingle.id,
        supplierId: 'abc',
        unitCost: dollarsToUnitPrice(38.75),
        effectiveFrom: '2026-07-01',
        source: 'supplier_quote',
        sourceReference: null,
      },
    ],
    labor: [],
    laborRates: [],
    synchronisedAt: '2026-09-18',
  }

  it('reprices an old estimate at the price that applied then', () => {
    expect(resolveMaterialPrice(book, shingle.id, '2026-03-14')?.unitCost).toBe(
      dollarsToUnitPrice(35.5),
    )
    expect(resolveMaterialPrice(book, shingle.id, '2026-09-18')?.unitCost).toBe(
      dollarsToUnitPrice(38.75),
    )
  })

  it('returns null rather than guessing before the first price', () => {
    expect(resolveMaterialPrice(book, shingle.id, '2025-12-31')).toBeNull()
  })
})

