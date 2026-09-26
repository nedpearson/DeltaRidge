import { openDB, type IDBPDatabase } from 'idb'
import { EbrGeocoder, streetLineOf, type GeocodeResult } from '@/integrations/geocode/ebr'
import { EbrParcelProvider, type ParcelRecord } from '@/integrations/parcel'
import { EbrPermitProvider } from '@/integrations/permits/ebr'
import type { PermitRecord } from '@/integrations/permits/types'
import { createStormProvider, type StormEvent } from '@/integrations/storm'
import { boundFetch } from '@/lib/fetch'
import {
  buildCoverage,
  emptyWindowExplanation,
  radarFailed,
  radarLive,
  RADAR_NOT_CONFIGURED,
  RADAR_OFF,
  type SourceStatus,
  type StormCoverage,
} from './coverage'
import {
  candidatesFromPermits,
  contractorActivity,
  distanceMiles,
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
import { bboxAround, expandBbox, type SearchCenter } from './search-area'

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
  /** [west, south, east, north]. Derived from searchCenter when location mode is active. */
  bbox: [number, number, number, number]
  /** Current GPS center for "search around me". Absent on legacy/cached runs. */
  searchCenter?: SearchCenter
  /** Geographic search radius around searchCenter. */
  searchRadiusMiles?: number
  /**
   * Which storm window to use. A rolling month count could not express "this
   * year", which is the question a rep actually asks in September.
   */
  windowKey: StormWindowKey
  customRange?: CustomRange
  /** Legacy rolling window, kept so a cached run from before still reads. */
  stormMonths: number
  minHailInches: number
  /**
   * Radar-estimated hail, alongside ground reports. Undefined on a run cached
   * before radar existed, which is read as off.
   */
  useRadar?: boolean
  /**
   * A HIGHER size floor for radar than for ground reports, and the difference
   * is not fussiness. MEHS is the largest hail a model infers *aloft*, and it
   * over-predicts badly in this market: measured over the service area for the
   * 24 months to 2026-09-24, 1,265 radar cell-days cleared 1.0" and only 12.6%
   * of them had any ground report within 15 km the same day. At 1.25" that is
   * 589 and 21.6%. Dropping this to 1.0" puts almost every door in the parish
   * "under hail" and the ranking stops discriminating.
   */
  radarMinHailInches?: number
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
  /**
   * Ceiling on parcel lookups per run. Each request carries a hundred
   * addresses, so two thousand is twenty requests — and every one of them
   * returns an owner, an occupancy signal and a centroid, not just a point.
   */
  maxParcelLookupsPerRun: number
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
  useRadar: true,
  radarMinHailInches: 1.25,
  radiusMiles: 3,
  searchRadiusMiles: 5,
  builtBefore: new Date().getFullYear() - 12,
  maxLeads: 150,
  maxGeocodesPerRun: 600,
  maxParcelLookupsPerRun: 2000,
}

/**
 * Bumped whenever a run produced by older code would show the rep something
 * misleading rather than merely something old.
 *
 * The case that forced this: radar hail shipped, the new bundle deployed, and
 * the storm panel still read NOT CONFIGURED — because the cached run was
 * written by the engine that had no radar, and 30 minutes of cache age had not
 * elapsed. New chrome, old answer, no way for the rep to tell. Age alone
 * cannot catch that: the run was fresh, it was just from a different engine.
 *
 * 2 = radar-estimated hail is a source.
 * 3 = lead search is explicitly GPS-centered when searchCenter is supplied.
 */
export const ENGINE_VERSION = 3

export interface LeadRun {
  ranAt: string
  /**
   * Which engine produced this. Absent on anything cached before the stamp
   * existed, which is exactly the case that must be treated as stale.
   */
  engineVersion?: number
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
    /** Of those, ground reports. Optional: absent on a run cached before radar. */
    officialReports?: number
    /** Of those, radar estimates above the radar size floor. */
    radarEstimates?: number
    /** Of the radar estimates, how many a ground report corroborates. */
    radarCorroborated?: number
    candidatesConsidered: number
    reroofPermits: number
    geocodedThisRun: number
    awaitingGeocode: number
    /** Addresses matched to a parish parcel, so the door has a name on it. */
    parcelsMatched: number
    /** Of those, how many the assessor's roll says are owner-occupied. */
    ownerOccupied: number
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
const PARCEL_STORE = 'parcels'
const LATEST = 'latest'

let dbPromise: Promise<IDBPDatabase> | null = null

/**
 * A database of its own, like the sync bookkeeping. Cached lead lists are
 * disposable; the rep's captured work is not, and the two must never share a
 * schema migration.
 */
function getLeadsDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 3, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) db.createObjectStore(STORE)
        // Geocodes are permanent: an address's coordinates do not change, so
        // this cache is never invalidated and each run starts further ahead.
        if (oldVersion < 2) db.createObjectStore(GEO_STORE)
        // Parcels are NOT permanent. A house does not move but it does change
        // hands, and a rep who greets last year's owner by name has done worse
        // than knock on a door with no name at all. Hence the TTL below.
        if (oldVersion < 3) db.createObjectStore(PARCEL_STORE)
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

/**
 * How long a cached owner is trusted.
 *
 * Thirty days is a compromise with a reason on each side. Parcel rolls update
 * on the parish's own schedule, not daily, so re-reading every run would spend
 * requests to be told the same thing. But property changes hands continuously,
 * and the failure mode of a stale owner is a rep using the wrong name on a
 * doorstep, which is worse than showing no name. Thirty days bounds that.
 */
const PARCEL_TTL_MS = 30 * 24 * 3600 * 1000

interface CachedParcel {
  record: ParcelRecord
  cachedAt: string
}

async function readParcelCache(
  streetLines: readonly string[],
  now: Date,
): Promise<Map<string, ParcelRecord>> {
  const out = new Map<string, ParcelRecord>()
  try {
    const db = await getLeadsDb()
    const tx = db.transaction(PARCEL_STORE, 'readonly')
    await Promise.all(
      streetLines.map(async (key) => {
        const hit = (await tx.store.get(key)) as CachedParcel | undefined
        if (!hit) return
        if (now.getTime() - new Date(hit.cachedAt).getTime() > PARCEL_TTL_MS) return
        out.set(key, hit.record)
      }),
    )
    await tx.done
  } catch {
    // No cache is a slower run, not a broken one.
  }
  return out
}

async function writeParcelCache(found: Map<string, ParcelRecord>, now: Date): Promise<void> {
  if (found.size === 0) return
  try {
    const db = await getLeadsDb()
    const tx = db.transaction(PARCEL_STORE, 'readwrite')
    const cachedAt = now.toISOString()
    for (const [key, record] of found) void tx.store.put({ record, cachedAt }, key)
    await tx.done
  } catch {
    // Losing the cache costs requests on the next run and nothing else.
  }
}

export interface RunDeps {
  fetchImpl?: typeof fetch
  now?: Date
}

/**
 * Which radar source this workspace is configured for.
 *
 * Deliberately NOT loadEnv(). That validates the WHOLE schema and throws when
 * VITE_SUPABASE_URL or the anon key is missing — which is true in CI, in a
 * fresh clone, and in any workspace with a typo in an unrelated key. The first
 * CI run on main caught exactly that: radar reported "not configured" for a
 * reason that had nothing to do with radar.
 *
 * Radar needs no credential. It is a public, keyless NOAA feed. Tying it to
 * Supabase config meant a bad Supabase key silently also turned off radar
 * hail — and a storm source that goes quiet for an unrelated reason is the one
 * failure this panel exists to prevent.
 *
 * Reading one key straight off the env source cannot throw, so there is
 * nothing to catch: anything other than an explicit 'off' means on.
 */
function radarProviderId(): 'swdi' | 'off' {
  const raw = (import.meta.env as Record<string, unknown>)['VITE_RADAR_HAIL']
  return raw === 'off' ? 'off' : 'swdi'
}

/**
 * How far a ground report can be from a radar estimate and still be about the
 * same hail. Ten miles, same UTC day.
 *
 * Louisiana spotter density is low and a single storm cell tracks tens of miles
 * across an afternoon, so a tighter radius would mark genuinely corroborated
 * hail as radar-only. A looser one would let an unrelated cell forty miles away
 * vouch for this one.
 */
export const CORROBORATION_MILES = 10

/**
 * Marks each radar estimate with whether a ground report stands behind it.
 *
 * This is the flag the spec asked for, and it exists so that nothing downstream
 * has to decide the question itself — the lead card, the coverage note and the
 * claim language all read the same field. Corroboration is not used to filter:
 * an uncorroborated estimate in a parish with no spotters is often real hail
 * nobody was there to see. It is used to say which one a rep is looking at.
 */
export function flagCorroboration(
  radar: readonly StormEvent[],
  official: readonly StormEvent[],
): StormEvent[] {
  const reportsByDay = new Map<string, StormEvent[]>()
  for (const report of official) {
    const day = report.occurredAt.slice(0, 10)
    const bucket = reportsByDay.get(day)
    if (bucket) bucket.push(report)
    else reportsByDay.set(day, [report])
  }

  return radar.map((event) => {
    const sameDay = reportsByDay.get(event.occurredAt.slice(0, 10)) ?? []
    const corroborated = sameDay.some(
      (r) =>
        distanceMiles(event.latitude, event.longitude, r.latitude, r.longitude) <=
        CORROBORATION_MILES,
    )
    return {
      ...event,
      radarConfidence: corroborated ? ('corroborated' as const) : ('radar_only' as const),
    }
  })
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

  const searchRadiusMiles = settings.searchRadiusMiles ?? DEFAULT_SETTINGS.searchRadiusMiles ?? 5
  const searchBbox =
    settings.searchCenter !== undefined
      ? bboxAround(settings.searchCenter, searchRadiusMiles)
      : settings.bbox
  // Storm reports just outside the property-search circle can still be relevant
  // to a property near the edge, so query a slightly larger storm envelope.
  const stormBbox = expandBbox(searchBbox, settings.radiusMiles)

  // Radar is on unless this workspace turned it off, or a cached run from
  // before radar existed is being re-run with its own settings.
  const radarEnabled = settings.useRadar !== false && radarProviderId() === 'swdi'
  const radarMinInches = settings.radarMinHailInches ?? DEFAULT_SETTINGS.radarMinHailInches ?? 1.25

  const window = resolveWindow(settings.windowKey, now, settings.customRange)
  const { from, to } = window

  // Fired together: they are independent, and a rep waiting in a driveway
  // should not pay for two round trips in series.
  const [stormResult, radarResult, buildResult, reroofResult] = await Promise.allSettled([
    storms.searchEvents({
      bbox: stormBbox,
      from,
      to,
      eventTypes: ['hail'],
      minHailSizeInches: settings.minHailInches,
    }),
    radarEnabled
      ? createStormProvider('swdi', fetchImpl).searchEvents({
          bbox: stormBbox,
          from,
          to,
          eventTypes: ['hail'],
          minHailSizeInches: radarMinInches,
        })
      : Promise.resolve<StormEvent[]>([]),
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
      bbox: searchBbox,
      kinds: ['reroof'],
      issuedFrom: from.slice(0, 10),
      limit: 5000,
    }),
  ])

  const officialEvents: StormEvent[] = stormResult.status === 'fulfilled' ? stormResult.value : []
  const rawRadarEvents: StormEvent[] = radarResult.status === 'fulfilled' ? radarResult.value : []
  const radarEvents = flagCorroboration(rawRadarEvents, officialEvents)
  // One list from here on. The two sources stay distinguishable on every event
  // via `observation`, which is what lets the coverage panel, the lead card and
  // the claim language keep them apart without keeping two arrays apart.
  const stormEvents: StormEvent[] = [...officialEvents, ...radarEvents]
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
  let radarStatus: SourceStatus
  if (!radarEnabled) {
    radarStatus = settings.useRadar === false ? RADAR_OFF : RADAR_NOT_CONFIGURED
  } else if (radarResult.status === 'rejected') {
    const why =
      radarResult.reason instanceof Error
        ? radarResult.reason.message
        : 'The NOAA radar hail service could not be reached on this run.'
    radarStatus = radarFailed(why)
    notes.push(`${why} Ground reports are still being used.`)
  } else {
    radarStatus = radarLive(
      radarEvents,
      radarMinInches,
      radarEvents.filter((e) => e.radarConfidence === 'corroborated').length,
    )
  }

  const coverage = buildCoverage(
    window,
    officialEvents,
    radarEvents,
    stormResult.status === 'rejected',
    radarStatus,
  )

  if (stormEvents.length === 0 && stormResult.status === 'fulfilled') {
    notes.push(
      `No hail of ${settings.minHailInches}" or larger was reported in the service area in ${window.label.toLowerCase()}. ` +
        emptyWindowExplanation(coverage),
    )
  }

  // ---- Owners, and the coordinates that come with them ----
  //
  // This step runs BEFORE geocoding and largely replaces it. The parish parcel
  // roll answers "where is this house" with a polygon it drew around the
  // house, and hands over the owner, the homestead exemption and the assessed
  // value in the same response. The geocoder answers only the first question,
  // one capped batch of 600 at a time, by interpolating along a street.
  //
  // Measured on 400 real pre-2014 residential build-permit addresses: 86%
  // matched in 4 requests, every match carrying geometry. The 14% that miss
  // are addresses the roll genuinely does not have, so the geocoder below
  // still runs — for those alone.
  const streetLines = [...new Set(buildPermits.map((p) => streetLineOf(p.address).toUpperCase()))]
  const parcels = await readParcelCache(streetLines, now)
  const parcelsToLookUp = streetLines
    .filter((line) => !parcels.has(line))
    .slice(0, settings.maxParcelLookupsPerRun)

  if (parcelsToLookUp.length > 0) {
    try {
      const found = await new EbrParcelProvider(fetchImpl).lookupByAddresses(parcelsToLookUp)
      await writeParcelCache(found, now)
      for (const [key, record] of found) parcels.set(key, record)
    } catch {
      // A door with no name is still a door. The list degrades to addresses
      // rather than disappearing.
      notes.push(
        'Owner records could not be loaded from the parish, so this list shows addresses without names on them.',
      )
    }
  }

  // Only the addresses the parcel roll could not place still need the locator.
  const needsGeocode = buildPermits.filter(
    (p) =>
      (p.latitude === undefined || p.longitude === undefined) &&
      !!p.addressKey &&
      !parcels.has(streetLineOf(p.address).toUpperCase()),
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
    // Parcel centroid first, even when the permit already carries a point: the
    // polygon is the parish's own outline of the lot, and the permit point for
    // anything pre-2016 came from a geocoder guessing along a street.
    const parcel = parcels.get(streetLineOf(p.address).toUpperCase())
    if (parcel?.latitude !== undefined && parcel.longitude !== undefined) {
      return { ...p, latitude: parcel.latitude, longitude: parcel.longitude }
    }
    if (p.latitude !== undefined && p.longitude !== undefined) return p
    const hit = cached.get(p.address)
    return hit ? { ...p, latitude: hit.latitude, longitude: hit.longitude } : p
  })

  const [west, south, east, north] = searchBbox
  const inArea = located.filter((p) => {
    if (p.latitude === undefined || p.longitude === undefined) return false
    if (
      p.latitude < south ||
      p.latitude > north ||
      p.longitude < west ||
      p.longitude > east
    ) return false

    if (settings.searchCenter === undefined) return true
    return (
      distanceMiles(
        settings.searchCenter.latitude,
        settings.searchCenter.longitude,
        p.latitude,
        p.longitude,
      ) <= searchRadiusMiles
    )
  })

  const awaitingGeocode = uncached.length - toGeocode.length
  if (awaitingGeocode > 0) {
    notes.push(
      `${awaitingGeocode.toLocaleString()} more addresses still need looking up. Refresh again to pull them in — each one is remembered, so the list keeps getting more complete.`,
    )
  }

  const candidates = candidatesFromPermits(inArea, parcels)
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
    engineVersion: ENGINE_VERSION,
    settings: {
      ...settings,
      bbox: searchBbox,
      searchRadiusMiles,
    },
    window,
    coverage,
    stormEvents,
    leads: leads.slice(0, settings.maxLeads),
    competitors: contractorActivity(reroofPermits),
    counts: {
      stormsConsidered: stormEvents.length,
      officialReports: officialEvents.length,
      radarEstimates: radarEvents.length,
      radarCorroborated: radarEvents.filter((e) => e.radarConfidence === 'corroborated').length,
      candidatesConsidered: candidates.length,
      reroofPermits: reroofPermits.length,
      geocodedThisRun,
      awaitingGeocode,
      parcelsMatched: candidates.filter((c) => c.parcel).length,
      ownerOccupied: candidates.filter((c) => c.parcel?.occupancy === 'owner_occupied').length,
      suppressedAlreadyReplaced: suppressed.alreadyReplaced,
      suppressedNoHail: suppressed.noQualifyingHail,
      suppressedRoofTooNew: suppressed.roofTooNew,
    },
    notes,
  }

  await writeCachedRun(run)
  return run
}
