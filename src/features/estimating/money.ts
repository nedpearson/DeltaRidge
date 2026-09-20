/**
 * Money and quantity arithmetic for the estimator.
 *
 * Every value here is an INTEGER at a documented scale. There is no float
 * money anywhere in the estimator, because a roof estimate is a number a
 * homeowner signs and an accountant later reconciles, and `0.1 + 0.2` is not
 * a defensible answer to either of them.
 *
 * Scales:
 *   Cents     - 1/100 dollar.      $18,950.00 -> 1_895_000
 *   UnitPrice - 1/10,000 dollar.   $0.0425/SF ->       425
 *   MilliQty  - 1/1000 unit.       38.2 SQ    ->    38_200
 *
 * Unit prices carry four decimal places on purpose. Suppliers quote
 * $0.0425/SF for underlayment and $1.235/LF for drip edge; at a thousandth of
 * a dollar the first of those rounds to $0.043, which is $2 of invented cost
 * on a 3,800 SF roof and a number nobody can reconcile against the invoice.
 */

const CENTS_PER_DOLLAR = 100
const UNIT_PRICE_PER_DOLLAR = 10_000
const MILLI_PER_UNIT = 1000

/** Integer cents. The only representation of a total anywhere. */
export type Cents = number & { readonly __scale: 'cents' }
/** Integer ten-thousandths of a dollar. Unit prices only, never totals. */
export type UnitPrice = number & { readonly __scale: 'unitPrice' }
/** Integer thousandths of a unit (SQ, LF, EA...). Quantities only. */
export type MilliQty = number & { readonly __scale: 'milliQty' }

function assertSafeInteger(value: number, what: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${what} is not finite: ${value}`)
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} exceeds exact integer range: ${value}`)
  }
}

/**
 * Half-up away from zero, the convention every invoice in the trade uses.
 * Math.round breaks ties toward +Infinity, so -0.5 rounds to -0 rather than
 * -1; credits and negative change orders would drift.
 */
export function roundHalfUp(value: number): number {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value)
  assertSafeInteger(rounded, 'rounded value')
  return rounded
}

export function cents(value: number): Cents {
  assertSafeInteger(value, 'cents')
  return value as Cents
}

export function unitPrice(value: number): UnitPrice {
  assertSafeInteger(value, 'unit price')
  return value as UnitPrice
}

export function milliQty(value: number): MilliQty {
  assertSafeInteger(value, 'milliQty')
  return value as MilliQty
}

/** $18,950.00 -> Cents. Accepts a decimal because humans type decimals. */
export function dollarsToCents(dollars: number): Cents {
  return cents(roundHalfUp(dollars * CENTS_PER_DOLLAR))
}

/** $0.0425 -> UnitPrice. */
export function dollarsToUnitPrice(dollars: number): UnitPrice {
  return unitPrice(roundHalfUp(dollars * UNIT_PRICE_PER_DOLLAR))
}

/** 38.2 -> MilliQty. */
export function unitsToMilli(units: number): MilliQty {
  return milliQty(roundHalfUp(units * MILLI_PER_UNIT))
}

export function centsToDollars(value: Cents): number {
  return value / CENTS_PER_DOLLAR
}

export function milliQtyToUnits(value: MilliQty): number {
  return value / MILLI_PER_UNIT
}

export const ZERO_CENTS = cents(0)

/**
 * Extend a line: quantity x unit price, rounded to the cent ONCE.
 *
 * MilliQty (1e-3 units) x UnitPrice (1e-4 dollars) lands at 1e-7 dollars, so
 * the divisor to reach cents is 1e5. Rounding happens here and nowhere else
 * in the chain - a total is the rounded product, never the sum of rounded
 * pieces.
 */
export function extend(quantity: MilliQty, price: UnitPrice): Cents {
  const product = quantity * price
  assertSafeInteger(product, 'quantity x unit price')
  return cents(roundHalfUp(product / 100_000))
}

export function addCents(...values: readonly Cents[]): Cents {
  let total = 0
  for (const v of values) total += v
  return cents(total)
}

export function subtractCents(a: Cents, b: Cents): Cents {
  return cents(a - b)
}

export function sumCents(values: Iterable<Cents>): Cents {
  let total = 0
  for (const v of values) total += v
  return cents(total)
}

/**
 * Basis points: 1/100 of a percent. 25% is 2500.
 *
 * Rates are integers for the same reason money is: a 23.5% margin stored as
 * 0.235 and multiplied through a dozen line items does not reproduce itself
 * when the proposal is regenerated six months later.
 */
export type Bps = number & { readonly __scale: 'bps' }

export const BPS_SCALE = 10_000

export function bps(value: number): Bps {
  assertSafeInteger(value, 'basis points')
  return value as Bps
}

export function percentToBps(percent: number): Bps {
  return bps(roundHalfUp(percent * 100))
}

export function bpsToPercent(value: Bps): number {
  return value / 100
}

/** Apply a rate to an amount: 1,000,000 cents at 2500 bps -> 250,000 cents. */
export function applyBps(amount: Cents, rate: Bps): Cents {
  const product = amount * rate
  assertSafeInteger(product, 'amount x bps')
  return cents(roundHalfUp(product / BPS_SCALE))
}
