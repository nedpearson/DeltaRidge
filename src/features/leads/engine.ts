import { openDB, type IDBPDatabase } from 'idb'
import { EbrGeocoder, type GeocodeResult } from '@/integrations/geocode/ebr'
import { EbrPermitProvider } from '@/integrations/permits/ebr'
import type { PermitRecord } from '@/integrations/permits/types'
import { createStormProvider, type StormEvent } from '@/integrations/storm'
import { boundFetch } from '@/lib/fetch'
import {
  buildCoverage,
  emptyWindowExplanation,
  RADAR_NOT_CONFIGURED,
  type StormCoverage,
} from './coverage'
import {
  candidatesFromPermits,
  contractorActivity,
  scoreLeads,
  type ContractorActivity,
  type ScoredLead,
} from './scoring'
import {
  resolveWindow,
  type CustomRange,
  type ResolvedWindow,
  type StormWindowKey,
} from './window'

/**
 * Runs the lead engine and remembers the result.
 *
 * Two constraints shaped this. First, the rep is in a truck: the run has to
 * survive going offline, so the last result is cached and the page opens from
 * cache instantly rather than blocking on the network. Second, both upstream
 * services — the parish permit feed and the NWS storm reports — are public,
 * keyless and CORS-open, so this needs no backend at all. That is why lead
 * generation can ship before the sync worker and the CompanyCam push do.
 */

export interface LeadRunSettings {
  /** [west, south, east, north] — defaults to the Delta Ridge service area. */
  bbox: [number, number, number, number]
  /**
   * Which storm window to use. A rolling month count could not express "this
   * year", which is the question a rep actually asks in September.
   */
  windowKey: StormWindowKey
  customRange?: CustomRange
  /** Legacy rolling window, kept so a cached run from before still reads. */
  stormMonths: number
  minHailInches: number
  radiusMiles: number
  /** Only consider roofs first permitted before this year. */
  builtBefore: number
  maxLeads: number
  /**
   * Ceiling on addresses geocoded per run. The parish locator is free and has
   * no published quota, but a rep in a driveway should not wait on two thousand
   * lookups. Results are cached permanently — addresses do not move — so the
   * coverage fills in over a few runs rather than all at once.
   */
  maxGeocodesPerRun: number
}

/**
 * Ascension, East Baton Rouge and Livingston parishes, plus a margin. Hail does
 * not stop at a parish line and neither does a rep's drive.
 */
export const SERVICE_AREA_BBOX: [number, number, number, number] = [-91.5, 30.1, -90.5, 30.9]

export const DEFAULT_SETTINGS: LeadRunSettings = {
  bbox: SERVICE_AREA_BBOX,
  windowKey: 'last_24_months',
  stormMonths: 24,
  minHailInches: 1,
  radiusMiles: 3,
  builtBefore: new Date().getFullYear() - 12,
  maxLeads: 150,
  maxGeocodesPerRun: 600,
}

export interface LeadRun {
  ranAt: string
  settings: LeadRunSettings
  /** The dates this run actually asked for, so the screen never re-derives them. */
  window: ResolvedWindow
  /** Which hail sources ran, which did not, and what each one found. */
  coverage: StormCoverage
  /**
   * The qualifying storms themselves. The page has to be able to show the
   * events behind the count, otherwise "26 hail reports" is unfalsifiable.
   */
  stormEvents: StormEvent[]
  leads: ScoredLead[]
  competitors: ContractorActivity[]
  counts: {
    stormsConsidered: number
    candidatesConsidered: number
    reroofPermits: number
    geocodedThisRun: number
    awaitingGeocode: number
    suppressedAlreadyReplaced: number
    suppressedNoHail: number
    suppressedRoofTooNew: number
  }
  /** Anything that degraded this run, in words a rep can act on. */
  notes: string[]
}

const DB_NAME = 'delta-ridge-leads'
const STORE = 'runs'
const GEO_STORE = 'geocodes'
const LATEST = 'latest'

let dbPromise: Promise<IDBPDatabase> | null = null

/**
 * A database of its own, like the sync bookkeeping. Cached lead lists are
 * disposable; the rep's captured work is not, and the two must never share a
 * schema migration.
 */
function getLeadsDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore(STORE)
        // Geocodes are permanent: an address's coordinates do not change, so
        // this cache is never invalidated and each run starts further ahead.
        if (oldVersion < 2) db.createObjectStore(GEO_STORE)
      },
    })
  }
  return dbPromise
}

/**
 * A run cached before storm windows existed has no window and no coverage.
 * Throwing it away would take a rep's list off the screen while they are
 * offline, so it is carried forward with its real dates reconstructed and its
 * storm list marked as unavailable rather than as empty.
 */
function upgradeRun(run: LeadRun): LeadRun {
  if (run.window && run.coverage) return run

  const ranAt = new Date(run.ranAt)
  const months = run.settings?.stormMonths ?? 24
  const from = new Date(ranAt)
  from.setMonth(from.getMonth() - months)
  const window: ResolvedWindow = {
    key: 'last_24_months',
    from: from.toISOString(),
    to: run.ranAt,
    label: `Last ${months} months`,
  }

  return {
    ...run,
    settings: { ...run.settings, windowKey: run.settings?.windowKey ?? 'last_24_months' },
    window,
    stormEvents: run.stormEvents ?? [],
    coverage: {
      window,
      official: {
        kind: 'live',
        newestAt: null,
        count: run.counts?.stormsConsidered ?? 0,
      },
      radar: RADAR_NOT_CONFIGURED,
      totalEvents: run.counts?.stormsConsidered ?? 0,
      currentYearEvents: 0,
      oldestAt: null,
      newestAt: null,
      byYear: [],
    },
  }
}

export async function readCachedRun(): Promise<LeadRun | null> {
  try {
    const db = await getLeadsDb()
    const run = (await db.get(STORE, LATEST)) as LeadRun | undefined
    return run ? upgradeRun(run) : null
  } catch {
    return null
  }
}

async function writeCachedRun(run: LeadRun): Promise<void> {
  try {
    const db = await getLeadsDb()
    await db.put(STORE, run, LATEST)
  } catch {
    // A full or blocked IndexedDB must not fail the run the rep is looking at.
  }
}

async function readGeocodeCache(keys: string[]): Promise<Map<string, GeocodeResult>> {
  const out = new Map<string, GeocodeResult>()
  try {
    const db = await getLeadsDb()
    const tx = db.transaction(GEO_STORE, 'readonly')
    await Promise.all(
      keys.map(async (key) => {
        const hit = (await tx.store.get(key)) as GeocodeResult | undefined
        if (hit) out.set(key, hit)
      }),
    )
    await tx.done
  } catch {
    // No cache is a slow run, not a broken one.
  }
  return out
}

async function writeGeocodeCache(found: Map<string, GeocodeResult>): Promise<void> {
  if (found.size === 0) return
  try {
    const db = await getLeadsDb()
    const tx = db.transaction(GEO_STORE, 'readwrite')
    for (const [key, value] of found) void tx.store.put(value, key)
    await tx.done
  } catch {
    // Losing the cache costs time on the next run and nothing else.
  }
}

export interface RunDeps {
  fetchImpl?: typeof fetch
  now?: Date
}

export async function runLeadEngine(
  settings: LeadRunSettings = DEFAULT_SETTINGS,
  deps: RunDeps = {},
): Promise<LeadRun> {
  const now = deps.now ?? new Date()
  const fetchImpl = boundFetch(deps.fetchImpl)
  const notes: string[] = []

  const storms = createStormProvider('noaa', fetchImpl)
  const permits = new EbrPermitProvider(fetchImpl)

  const window = resolveWindow(settings.windowKey, now, settings.customRange)
  const { from, to } = window

  // Fired together: they are independent, and a rep waiting in a driveway
  // should not pay for two round trips in series.
  const [stormResult, buildResult, reroofResult] = await Promise.allSettled([
    storms.searchEvents({
      bbox: settings.bbox,
      from,
      to,
      eventTypes: ['hail'],
      minHailSizeInches: settings.minHailInches,
    }),
    // Deliberately NOT bbox-filtered. The parish only began populating
    // coordinates on permits around 2016, so a bbox filter — which is a
    // server-side test on lat/long — silently throws away almost every permit
    // old enough to matter: 13 records survive out of 2,327. These are
    // geocoded below and filtered to the service area afterwards.
    permits.search({
      kinds: ['new_build'],
      issuedTo: `${settings.builtBefore}-12-31`,
      limit: 5000,
    }),
    permits.search({
      bbox: settings.bbox,
      kinds: ['reroof'],
      issuedFrom: from.slice(0, 10),
      limit: 5000,
    }),
  ])

  const stormEvents: StormEvent[] = stormResult.status === 'fulfilled' ? stormResult.value : []
  const buildPermits: PermitRecord[] = buildResult.status === 'fulfilled' ? buildResult.value : []
  const reroofPermits: PermitRecord[] = reroofResult.status === 'fulfilled' ? reroofResult.value : []

  if (stormResult.status === 'rejected') {
    notes.push('Storm reports could not be loaded, so nothing can be ranked by hail right now.')
  }
  if (buildResult.status === 'rejected') {
    notes.push('Parish permit records could not be loaded, so roof age is unknown for this run.')
  }
  if (reroofResult.status === 'rejected') {
    // This one is worth spelling out: without it the list is still useful but
    // will include roofs that have already been replaced.
    notes.push(
      'Re-roof permits could not be loaded, so this list has NOT been filtered for roofs that were already replaced.',
    )
  }
  const coverage = buildCoverage(window, stormEvents, stormResult.status === 'rejected')

  if (stormEvents.length === 0 && stormResult.status === 'fulfilled') {
    notes.push(
      `No hail of ${settings.minHailInches}" or larger was reported in the service area in ${window.label.toLowerCase()}. ` +
        emptyWindowExplanation(coverage),
    )
  }

  // Fill in coordinates for the permits that predate the parish geocoding its
  // own records. Cache first, then the locator, capped per run.
  const needsGeocode = buildPermits.filter(
    (p) => (p.latitude === undefined || p.longitude === undefined) && p.addressKey,
  )
  const cached = await readGeocodeCache(needsGeocode.map((p) => p.address))
  const uncached = needsGeocode.filter((p) => !cached.has(p.address))
  const toGeocode = uncached.slice(0, settings.maxGeocodesPerRun)

  let geocodedThisRun = 0
  if (toGeocode.length > 0) {
    try {
      const { results, failedBatches, totalBatches } = await new EbrGeocoder(fetchImpl).geocodeAll(
        toGeocode.map((p) => p.address),
      )
      await writeGeocodeCache(results)
      for (const [address, result] of results) cached.set(address, result)
      geocodedThisRun = results.size
      if (failedBatches === totalBatches && totalBatches > 0) {
        notes.push(
          'The parish address lookup could not be reached, so only permits that already carry coordinates are ranked. That is most of the older housing stock missing.',
        )
      }
    } catch {
      notes.push('Addresses could not be looked up, so only permits that already carry coordinates are ranked.')
    }
  }

  const located: PermitRecord[] = buildPermits.map((p) => {
    if (p.latitude !== undefined && p.longitude !== undefined) return p
    const hit = cached.get(p.address)
    return hit ? { ...p, latitude: hit.latitude, longitude: hit.longitude } : p
  })

  const [west, south, east, north] = settings.bbox
  const inArea = located.filter(
    (p) =>
      p.latitude !== undefined &&
      p.longitude !== undefined &&
      p.latitude >= south &&
      p.latitude <= north &&
      p.longitude >= west &&
      p.longitude <= east,
  )

  const awaitingGeocode = uncached.length - toGeocode.length
  if (awaitingGeocode > 0) {
    notes.push(
      `${awaitingGeocode.toLocaleString()} more addresses still need looking up. Refresh again to pull them in — each one is remembered, so the list keeps getting more complete.`,
    )
  }

  const candidates = candidatesFromPermits(inArea)
  const { leads, suppressed } = scoreLeads({
    candidates,
    storms: stormEvents,
    reroofPermits,
    radiusMiles: settings.radiusMiles,
    minHailInches: settings.minHailInches,
    now,
  })

  const run: LeadRun = {
    ranAt: now.toISOString(),
    settings,
    window,
    coverage,
    stormEvents,
    leads: leads.slice(0, settings.maxLeads),
    competitors: contractorActivity(reroofPermits),
    counts: {
      stormsConsidered: stormEvents.length,
      candidatesConsidered: candidates.length,
      reroofPermits: reroofPermits.length,
      geocodedThisRun,
      awaitingGeocode,
      suppressedAlreadyReplaced: suppressed.alreadyReplaced,
      suppressedNoHail: suppressed.noQualifyingHail,
      suppressedRoofTooNew: suppressed.roofTooNew,
    },
    notes,
  }

  await writeCachedRun(run)
  return run
}
