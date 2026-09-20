import { describe, expect, it } from 'vitest'
import {
  addCents,
  applyBps,
  bps,
  cents,
  dollarsToCents,
  dollarsToUnitPrice,
  extend,
  percentToBps,
  roundHalfUp,
  unitsToMilli,
} from '@/features/estimating/money'
import {
  authorisePrice,
  marginOf,
  markupOf,
  priceFromMargin,
  priceFromMarkup,
  priceLadder,
  type MarginPolicy,
} from '@/features/estimating/margin'

describe('money scales', () => {
  it('converts dollars without float drift', () => {
    expect(dollarsToCents(18_950)).toBe(1_895_000)
    expect(dollarsToCents(0.1) + dollarsToCents(0.2)).toBe(dollarsToCents(0.3))
    expect(dollarsToUnitPrice(1.235)).toBe(12_350)
    expect(dollarsToUnitPrice(0.0425)).toBe(425)
    expect(unitsToMilli(38.2)).toBe(38_200)
  })

  it('rounds half up away from zero', () => {
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(-0.5)).toBe(-1)
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-3)
  })

  it('rejects values that would lose integer precision', () => {
    expect(() => cents(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError)
    expect(() => cents(Number.NaN)).toThrow(RangeError)
  })

  it('extends a line with one rounding step', () => {
    // 3,820 SF of underlayment at $0.0425/SF = $162.35
    expect(extend(unitsToMilli(3820), dollarsToUnitPrice(0.0425))).toBe(16_235)
    // 38.2 SQ at $1.235 = $47.177 -> $47.18
    expect(extend(unitsToMilli(38.2), dollarsToUnitPrice(1.235))).toBe(4718)
  })

  it('sums cents exactly, however many lines', () => {
    const lines = Array.from({ length: 1000 }, () => dollarsToCents(1.11))
    expect(addCents(...lines)).toBe(dollarsToCents(1_110))
  })

  it('rounds the extension once instead of summing rounded pieces', () => {
    // 1,000 EA at $1.115. Rounding per-unit first gives $1,120; the line is $1,115.
    const line = extend(unitsToMilli(1_000), dollarsToUnitPrice(1.115))
    expect(line).toBe(dollarsToCents(1_115))
    const perUnitFirst = addCents(
      ...Array.from({ length: 1_000 }, () => dollarsToCents(1.115)),
    )
    expect(perUnitFirst).toBe(dollarsToCents(1_120))
    expect(line).not.toBe(perUnitFirst)
  })

  it('applies a rate in basis points', () => {
    expect(percentToBps(8.5)).toBe(850)
    expect(applyBps(dollarsToCents(18_000), bps(850))).toBe(dollarsToCents(1530))
  })
})

describe('markup is not margin', () => {
  const cost = dollarsToCents(10_000)

  it('25% markup gives $12,500 and a 20% margin', () => {
    const price = priceFromMarkup(cost, percentToBps(25))
    expect(price).toBe(dollarsToCents(12_500))
    expect(marginOf(price, cost)).toBe(percentToBps(20))
  })

  it('25% margin gives $13,333.33 and a 33.33% markup', () => {
    const price = priceFromMargin(cost, percentToBps(25))
    expect(price).toBe(dollarsToCents(13_333.33))
    expect(markupOf(price, cost)).toBe(3333)
  })

  it('round-trips a margin through a price', () => {
    for (const percent of [5, 12.5, 22, 33.75, 48]) {
      const price = priceFromMargin(cost, percentToBps(percent))
      expect(marginOf(price, cost)).toBe(percentToBps(percent))
    }
  })

  it('refuses a margin of 100% or more', () => {
    expect(() => priceFromMargin(cost, percentToBps(100))).toThrow(RangeError)
  })
})

describe('price ladder and authorisation', () => {
  const policy: MarginPolicy = {
    standardMargin: percentToBps(38),
    targetMargin: percentToBps(35),
    floorMargin: percentToBps(30),
    stopMargin: percentToBps(26),
  }
  const cost = dollarsToCents(12_100)

  it('descends from standard to stop', () => {
    const ladder = priceLadder(cost, policy)
    expect(ladder.standard).toBeGreaterThan(ladder.target)
    expect(ladder.target).toBeGreaterThan(ladder.floor)
    expect(ladder.floor).toBeGreaterThan(ladder.stop)
    expect(marginOf(ladder.stop, cost)).toBe(percentToBps(26))
  })

  it('rejects a policy that does not descend', () => {
    expect(() =>
      priceLadder(cost, { ...policy, stopMargin: percentToBps(40) }),
    ).toThrow(RangeError)
  })

  it('routes a discount to the right approver', () => {
    const ladder = priceLadder(cost, policy)
    expect(authorisePrice(ladder.standard, cost, policy)).toEqual({
      allowed: true,
      level: 'rep',
    })
    expect(authorisePrice(ladder.target, cost, policy)).toEqual({
      allowed: true,
      level: 'rep',
    })
    expect(authorisePrice(ladder.floor, cost, policy)).toEqual({
      allowed: true,
      level: 'manager',
    })
    expect(authorisePrice(ladder.stop, cost, policy)).toEqual({
      allowed: true,
      level: 'owner',
    })
  })

  it('refuses any price below the stop margin', () => {
    const ladder = priceLadder(cost, policy)
    const verdict = authorisePrice(cents(ladder.stop - dollarsToCents(200)), cost, policy)
    expect(verdict.allowed).toBe(false)
    if (!verdict.allowed) expect(verdict.reason).toContain('below the stop margin')
  })
})

