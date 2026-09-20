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

/**
 * A saved estimate version.
 *
 * The cost sheet and the margin policy are COPIED IN, not referenced. That is
 * the whole point: a proposal written in March has to reproduce itself in
 * September, and it cannot if it reprices against whatever the cost sheet
 * happens to say today. Suppliers raise prices; a saved number must not move
 * underneath a homeowner who was quoted it.
 *
 * Versions are append-only, mirroring `estimate_versions` in migration 0011.
 * Revising an estimate adds a version; nothing is edited in place.
 */
export interface SavedVersion {
  readonly versionNumber: number
  readonly createdAt: string
  readonly geometry: SavedGeometry
  /** The costs AS PRICED. Never re-read from the live sheet. */
  readonly costs: CostSheet
  readonly margins: MarginSettings
  readonly directCostCents: number
  readonly overheadCents: number
  readonly jobCostCents: number
  readonly sellPriceCents: number
  readonly gapCount: number
}

/** The measurement form, stored as entered so it can be reopened and edited. */
export type SavedGeometry = Record<string, string>

export interface SavedEstimate {
  readonly id: string
  readonly inspectionId: string | null
  readonly label: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly versions: readonly SavedVersion[]
}

interface EstimatingDB extends DBSchema {
  settings: { key: string; value: { id: string; costs: CostSheet; margins: MarginSettings; updatedAt: string } }
  estimates: { key: string; value: SavedEstimate; indexes: { 'by-inspection': string } }
}

let dbPromise: Promise<IDBPDatabase<EstimatingDB>> | null = null

/**
 * Version 2 and a guarded create.
 *
 * A database can exist at version 1 without the store - a deleted-and-
 * reopened database is the way it happens, and an unguarded
 * createObjectStore then throws "already exists" on the other path. Bumping
 * the version means an existing broken database is repaired rather than left
 * to fail every read.
 */
function getDB(): Promise<IDBPDatabase<EstimatingDB>> {
  if (!dbPromise) {
    dbPromise = openDB<EstimatingDB>('delta-ridge-estimating', 3, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('estimates')) {
          const estimates = db.createObjectStore('estimates', { keyPath: 'id' })
          estimates.createIndex('by-inspection', 'inspectionId')
        }
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

/**
 * Never rejects.
 *
 * Both screens do `readSettings().then(() => setLoading(false))`, so a
 * rejection leaves them on "Loading…" forever with nothing on screen and
 * nothing in the console - which is exactly what happened when the database
 * existed without its object store. Storage can fail for reasons that have
 * nothing to do with this app: private browsing, a full device, a corrupted
 * profile. An unusable cost sheet is recoverable; a frozen screen is not.
 */
export async function readSettings(): Promise<EstimatingSettings> {
  try {
    const row = await (await getDB()).get('settings', SETTINGS_ID)
    if (!row) return { costs: {}, margins: DEFAULT_MARGINS, updatedAt: null }
    return { costs: row.costs, margins: row.margins, updatedAt: row.updatedAt }
  } catch {
    dbPromise = null
    return { costs: {}, margins: DEFAULT_MARGINS, updatedAt: null }
  }
}

export async function writeSettings(
  costs: CostSheet,
  margins: MarginSettings,
): Promise<string> {
  const updatedAt = new Date().toISOString()
  await (await getDB()).put('settings', { id: SETTINGS_ID, costs, margins, updatedAt })
  return updatedAt
}

function newEstimateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `est-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export interface VersionInput {
  readonly geometry: SavedGeometry
  readonly costs: CostSheet
  readonly margins: MarginSettings
  readonly directCostCents: number
  readonly overheadCents: number
  readonly jobCostCents: number
  readonly sellPriceCents: number
  readonly gapCount: number
}

/**
 * Appends a version, creating the estimate if this is the first one.
 *
 * Never edits an existing version. The saved numbers are what somebody was
 * shown; a revision is a new version sitting beside the old one.
 */
export async function saveVersion(
  estimateId: string | null,
  inspectionId: string | null,
  label: string,
  input: VersionInput,
): Promise<SavedEstimate> {
  const db = await getDB()
  const now = new Date().toISOString()
  const existing = estimateId ? await db.get('estimates', estimateId) : undefined

  const version: SavedVersion = {
    versionNumber: (existing?.versions.length ?? 0) + 1,
    createdAt: now,
    ...input,
  }

  const estimate: SavedEstimate = existing
    ? { ...existing, updatedAt: now, versions: [...existing.versions, version] }
    : {
        id: estimateId ?? newEstimateId(),
        inspectionId,
        label,
        createdAt: now,
        updatedAt: now,
        versions: [version],
      }

  await db.put('estimates', estimate)
  return estimate
}

export async function listEstimates(): Promise<readonly SavedEstimate[]> {
  try {
    const rows = await (await getDB()).getAll('estimates')
    return [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    dbPromise = null
    return []
  }
}

export async function estimatesForInspection(
  inspectionId: string,
): Promise<readonly SavedEstimate[]> {
  try {
    const rows = await (await getDB()).getAllFromIndex(
      'estimates',
      'by-inspection',
      inspectionId,
    )
    return [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    dbPromise = null
    return []
  }
}

export async function readEstimate(id: string): Promise<SavedEstimate | null> {
  try {
    return (await (await getDB()).get('estimates', id)) ?? null
  } catch {
    dbPromise = null
    return null
  }
}

/** Latest version, or null for an estimate with none (which should not exist). */
export function latestVersion(estimate: SavedEstimate): SavedVersion | null {
  return estimate.versions[estimate.versions.length - 1] ?? null
}

/**
 * Whether the live cost sheet still matches what a version was priced against.
 *
 * Used to say "your costs have changed since this was priced" rather than
 * silently repricing a saved number. Only the keys the version actually used
 * are compared: a cost the roof never needed changing is not a reason to warn
 * anybody.
 */
export function costsDrifted(version: SavedVersion, current: CostSheet): boolean {
  const keys = Object.keys(version.costs) as CostKey[]
  return keys.some((k) => version.costs[k] !== current[k])
}
