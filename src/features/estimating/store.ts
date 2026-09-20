import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { dollarsToCents, dollarsToUnitPrice, percentToBps } from './money'
import type { MarginPolicy } from './margin'
import type { PriceLinkedRates, OverheadPolicy } from './cost'

/**
 * The cost book, on the device.
 *
 * It lives in IndexedDB rather than Postgres for the same reason inspections
 * do: a rep works in a driveway, and an estimate that needs a signed-in
 * session and a round trip is an estimate that cannot be written where it is
 * actually needed. Migration 0011 holds the server-side shape for when the
 * office syncs; the types here are deliberately the same ones.
 *
 * Every figure is entered by Delta Ridge. NOTHING here ships with a price.
 * A plausible-looking default cost is worse than an empty field: the empty
 * field gets filled in, and the default quietly prices a roof.
 */

/** The handful of numbers that actually drive a shingle re-roof price. */
export type CostKey =
  | 'shingle_sq'
  | 'underlayment_sq'
  | 'starter_lf'
  | 'cap_lf'
  | 'drip_edge_lf'
  | 'valley_lf'
  | 'pipe_boot_ea'
  | 'ridge_vent_lf'
  | 'tear_off_sq'
  | 'install_sq'
  | 'decking_sheet'
  | 'steep_sq'
  | 'high_job'
  | 'disposal_job'
  | 'permit_job'

export interface CostEntrySpec {
  readonly key: CostKey
  readonly label: string
  readonly unit: string
  readonly category: 'material' | 'labor' | 'other'
  /** What the rep should actually look at to answer this. */
  readonly help: string
}

export const COST_ENTRIES: readonly CostEntrySpec[] = [
  { key: 'shingle_sq', label: 'Architectural shingle', unit: '$/SQ', category: 'material',
    help: 'Delivered cost of one square (3 bundles) on your current supplier invoice.' },
  { key: 'underlayment_sq', label: 'Synthetic underlayment', unit: '$/SQ', category: 'material',
    help: 'Roll cost divided by the squares it covers.' },
  { key: 'starter_lf', label: 'Starter course', unit: '$/LF', category: 'material',
    help: 'Bundle cost divided by its linear feet.' },
  { key: 'cap_lf', label: 'Hip and ridge cap', unit: '$/LF', category: 'material',
    help: 'Bundle cost divided by its linear feet.' },
  { key: 'drip_edge_lf', label: 'Drip edge', unit: '$/LF', category: 'material',
    help: 'Stick cost divided by 10 ft.' },
  { key: 'valley_lf', label: 'Valley metal', unit: '$/LF', category: 'material',
    help: 'Stick cost divided by its length.' },
  { key: 'pipe_boot_ea', label: 'Pipe boot', unit: '$/EA', category: 'material',
    help: 'Each, for the size you fit most often.' },
  { key: 'ridge_vent_lf', label: 'Ridge vent', unit: '$/LF', category: 'material',
    help: 'Stick cost divided by its length.' },
  { key: 'tear_off_sq', label: 'Tear off, per layer', unit: '$/SQ', category: 'labor',
    help: 'What you actually pay the crew or sub, per square, per layer.' },
  { key: 'install_sq', label: 'Install shingle', unit: '$/SQ', category: 'labor',
    help: 'Crew or subcontract rate per square, burdened.' },
  { key: 'decking_sheet', label: 'Decking, installed', unit: '$/SHEET', category: 'labor',
    help: 'Material plus labour for one replaced sheet.' },
  { key: 'steep_sq', label: 'Steep slope adder', unit: '$/SQ', category: 'labor',
    help: 'Extra per square on facets at or above 8/12. Enter 0 if you do not charge one.' },
  { key: 'high_job', label: 'High roof adder', unit: '$/job', category: 'labor',
    help: 'Flat adder for two storeys or a high eave. Enter 0 if you do not charge one.' },
  { key: 'disposal_job', label: 'Disposal', unit: '$/job', category: 'other',
    help: 'Dumpster or haul-off for a typical roof.' },
  { key: 'permit_job', label: 'Permit', unit: '$/job', category: 'other',
    help: 'Leave blank if the fee is not known - the estimate will say so.' },
]

/** Dollars as the rep typed them. Converted at the point of use, never before. */
export type CostSheet = Partial<Record<CostKey, number>>

export interface MarginSettings {
  readonly standardPercent: number
  readonly targetPercent: number
  readonly floorPercent: number
  readonly stopPercent: number
  readonly overheadPercent: number
  readonly overheadMinimumDollars: number
  readonly commissionPercent: number
  readonly financingDealerFeePercent: number
  readonly cardProcessingPercent: number
}

/**
 * Margins ARE defaulted, unlike costs, and the difference is deliberate: a
 * margin is a policy Delta Ridge chooses and can see on screen, while a cost
 * is a fact about the world that only the invoice knows. Getting the margin
 * wrong shows up immediately in the price; getting an invented cost wrong is
 * invisible until the job loses money.
 */
export const DEFAULT_MARGINS: MarginSettings = {
  standardPercent: 38,
  targetPercent: 35,
  floorPercent: 30,
  stopPercent: 26,
  overheadPercent: 12,
  overheadMinimumDollars: 250,
  commissionPercent: 8,
  financingDealerFeePercent: 0,
  cardProcessingPercent: 0,
}

export function marginPolicyFrom(s: MarginSettings): MarginPolicy {
  return {
    standardMargin: percentToBps(s.standardPercent),
    targetMargin: percentToBps(s.targetPercent),
    floorMargin: percentToBps(s.floorPercent),
    stopMargin: percentToBps(s.stopPercent),
  }
}

export function overheadPolicyFrom(s: MarginSettings): OverheadPolicy {
  return {
    rate: percentToBps(s.overheadPercent),
    minimum: dollarsToCents(s.overheadMinimumDollars),
  }
}

export function ratesFrom(s: MarginSettings): PriceLinkedRates {
  return {
    commission: percentToBps(s.commissionPercent),
    financingDealerFee: percentToBps(s.financingDealerFeePercent),
    cardProcessing: percentToBps(s.cardProcessingPercent),
  }
}

/** Null when the rep has not entered this cost. Never a guess. */
export function unitPriceFor(sheet: CostSheet, key: CostKey) {
  const dollars = sheet[key]
  if (dollars === undefined || !Number.isFinite(dollars)) return null
  return dollarsToUnitPrice(dollars)
}

export function missingCosts(sheet: CostSheet): readonly CostEntrySpec[] {
  return COST_ENTRIES.filter((e) => {
    const v = sheet[e.key]
    return v === undefined || !Number.isFinite(v)
  })
}

/** A cost sheet is usable once the items every re-roof needs are present. */
export const ESSENTIAL_COSTS: readonly CostKey[] = [
  'shingle_sq',
  'underlayment_sq',
  'starter_lf',
  'cap_lf',
  'drip_edge_lf',
  'tear_off_sq',
  'install_sq',
  'disposal_job',
]

export function isUsable(sheet: CostSheet): boolean {
  return ESSENTIAL_COSTS.every((k) => {
    const v = sheet[k]
    return v !== undefined && Number.isFinite(v) && v > 0
  })
}

interface EstimatingDB extends DBSchema {
  settings: { key: string; value: { id: string; costs: CostSheet; margins: MarginSettings; updatedAt: string } }
}

let dbPromise: Promise<IDBPDatabase<EstimatingDB>> | null = null

function getDB(): Promise<IDBPDatabase<EstimatingDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EstimatingDB>('delta-ridge-estimating', 1, {
      upgrade(db) {
        db.createObjectStore('settings', { keyPath: 'id' })
      },
    })
  }
  return dbPromise
}

const SETTINGS_ID = 'current'

export interface EstimatingSettings {
  readonly costs: CostSheet
  readonly margins: MarginSettings
  readonly updatedAt: string | null
}

export async function readSettings(): Promise<EstimatingSettings> {
  const row = await (await getDB()).get('settings', SETTINGS_ID)
  if (!row) return { costs: {}, margins: DEFAULT_MARGINS, updatedAt: null }
  return { costs: row.costs, margins: row.margins, updatedAt: row.updatedAt }
}

export async function writeSettings(
  costs: CostSheet,
  margins: MarginSettings,
): Promise<string> {
  const updatedAt = new Date().toISOString()
  await (await getDB()).put('settings', { id: SETTINGS_ID, costs, margins, updatedAt })
  return updatedAt
}
