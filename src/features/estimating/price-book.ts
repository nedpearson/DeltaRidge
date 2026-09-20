import {
  extend,
  milliQty,
  unitPrice,
  unitsToMilli,
  type Cents,
  type UnitPrice,
} from './money'

/**
 * The price book is append-only and effective-dated.
 *
 * A proposal written in March has to reproduce itself in September, which
 * means the estimator never asks "what does this cost?" - it asks "what did
 * this cost on the day this estimate was priced?". Overwriting a price
 * destroys that, so prices are never updated in place; a new record with a
 * later `effectiveFrom` supersedes the old one.
 */

export type Unit =
  | 'SQ'
  | 'SF'
  | 'LF'
  | 'EA'
  | 'BDL'
  | 'ROLL'
  | 'SHEET'
  | 'HR'
  | 'DAY'
  | 'LOAD'

export type MaterialCategory =
  | 'shingle'
  | 'metal'
  | 'tile'
  | 'low_slope'
  | 'underlayment'
  | 'leak_barrier'
  | 'starter'
  | 'hip_ridge'
  | 'drip_edge'
  | 'valley'
  | 'flashing'
  | 'boot'
  | 'vent'
  | 'fastener'
  | 'sealant'
  | 'decking'
  | 'gutter'
  | 'accessory'

export interface MaterialItem {
  readonly id: string
  readonly category: MaterialCategory
  readonly manufacturer: string | null
  readonly productFamily: string | null
  readonly sku: string | null
  readonly description: string
  readonly unit: Unit
  /**
   * How much roof one purchase unit covers, in the unit the scope is measured
   * in. A shingle bundle covering 33.3 SF has `coveragePerUnit: 33.3`.
   * Null for items counted directly (a pipe boot is 1 EA per 1 EA).
   */
  readonly coveragePerUnit: number | null
  /** Purchase units that must be bought together, e.g. 3 bundles per square. */
  readonly saleIncrement: number
  readonly impactRating: string | null
  readonly windRatingMph: number | null
  readonly fortifiedEligible: boolean
}

export interface MaterialPrice {
  readonly materialItemId: string
  readonly supplierId: string
  readonly unitCost: UnitPrice
  readonly effectiveFrom: string
  /** How this price was obtained. Never invented. */
  readonly source: 'supplier_api' | 'supplier_quote' | 'invoice' | 'manual'
  readonly sourceReference: string | null
}

export type LaborUnit = Extract<Unit, 'SQ' | 'SF' | 'LF' | 'EA' | 'SHEET' | 'HR' | 'DAY'>

export interface LaborItem {
  readonly id: string
  readonly description: string
  readonly unit: LaborUnit
  /** Units a full crew completes per hour. Used for scheduling, not pricing. */
  readonly productionRatePerHour: number | null
  readonly crewSize: number | null
  readonly minimumCharge: Cents | null
}

export interface LaborRate {
  readonly laborItemId: string
  readonly unitCost: UnitPrice
  readonly effectiveFrom: string
  readonly source: 'subcontract_quote' | 'internal_burdened' | 'manual'
  readonly sourceReference: string | null
}

export interface PriceBook {
  readonly id: string
  readonly version: string
  readonly materials: readonly MaterialItem[]
  readonly materialPrices: readonly MaterialPrice[]
  readonly labor: readonly LaborItem[]
  readonly laborRates: readonly LaborRate[]
  /** When this book was last synchronised, so stale pricing can be shown as stale. */
  readonly synchronisedAt: string
}

function latestEffective<T extends { readonly effectiveFrom: string }>(
  records: readonly T[],
  asOf: string,
): T | null {
  let best: T | null = null
  for (const record of records) {
    if (record.effectiveFrom > asOf) continue
    if (best === null || record.effectiveFrom > best.effectiveFrom) best = record
  }
  return best
}

export function resolveMaterialPrice(
  book: PriceBook,
  materialItemId: string,
  asOf: string,
  supplierId?: string,
): MaterialPrice | null {
  const candidates = book.materialPrices.filter(
    (p) =>
      p.materialItemId === materialItemId &&
      (supplierId === undefined || p.supplierId === supplierId),
  )
  return latestEffective(candidates, asOf)
}

export function resolveLaborRate(
  book: PriceBook,
  laborItemId: string,
  asOf: string,
): LaborRate | null {
  return latestEffective(
    book.laborRates.filter((r) => r.laborItemId === laborItemId),
    asOf,
  )
}

export function findMaterial(book: PriceBook, id: string): MaterialItem | null {
  return book.materials.find((m) => m.id === id) ?? null
}

export function findLabor(book: PriceBook, id: string): LaborItem | null {
  return book.labor.find((l) => l.id === id) ?? null
}

export interface PurchaseQuantity {
  readonly scopeQuantity: number
  readonly purchaseUnits: number
  readonly unit: Unit
  /** Coverage bought beyond the scope quantity because of sale increments. */
  readonly overageQuantity: number
}

/**
 * Convert a scope quantity into whole purchase units.
 *
 * Suppliers do not sell 2.4 bundles. Rounding up is a real cost and it shows
 * as overage rather than disappearing into waste, so the estimator can see
 * that 38.2 SQ became 117 bundles and why.
 */
export function purchaseQuantityFor(
  item: MaterialItem,
  scopeQuantity: number,
): PurchaseQuantity {
  if (scopeQuantity < 0) throw new RangeError('scope quantity cannot be negative')
  const perUnit = item.coveragePerUnit ?? 1
  if (perUnit <= 0) throw new RangeError(`${item.id} has a non-positive coveragePerUnit`)
  const rawUnits = scopeQuantity / perUnit
  const increment = item.saleIncrement > 0 ? item.saleIncrement : 1
  const purchaseUnits = Math.ceil(rawUnits / increment) * increment
  return {
    scopeQuantity,
    purchaseUnits,
    unit: item.unit,
    overageQuantity: purchaseUnits * perUnit - scopeQuantity,
  }
}

/** Extended cost of a purchase, at the resolved price. */
export function extendPurchase(purchase: PurchaseQuantity, unitCost: UnitPrice): Cents {
  return extend(unitsToMilli(purchase.purchaseUnits), unitCost)
}

export function extendScope(quantity: number, unitCost: UnitPrice): Cents {
  return extend(unitsToMilli(quantity), unitCost)
}

export const ZERO_UNIT_PRICE = unitPrice(0)
export const ZERO_QTY = milliQty(0)

