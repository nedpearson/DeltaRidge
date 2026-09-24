import { boundFetch } from '@/lib/fetch'
import type {
  ProviderAvailability,
  StormEvent,
  StormGeometry,
  StormProvider,
  StormQuery,
} from './types'

/**
 * Radar-estimated hail, from NOAA NCEI's Severe Weather Data Inventory.
 *
 * WHY THIS AND NOT MRMS. The plan was MRMS MESH off `s3://noaa-mrms-pds`, and
 * the blocker recorded on the screen for months was real: MRMS ships GRIB2
 * grids, a browser cannot decode them, and this application has no server. So
 * "radar-estimated hail" stayed NOT CONFIGURED.
 *
 * SWDI answers the same question without the grid. `nx3hail` is the NEXRAD
 * Level-III Hail Detection Algorithm output — per storm cell, per volume scan,
 * with MEHS (maximum estimated hail size) in inches — served as plain CSV over
 * HTTPS, no key, and verified on 2026-09-24 to answer with
 * `Access-Control-Allow-Origin: *`. A browser can read it directly, which is
 * exactly what MRMS could not do.
 *
 * Verified live on 2026-09-24:
 *   https://www.ncei.noaa.gov/swdiws/csv/nx3hail/20260501:20260531?bbox=-91.5,30.1,-90.5,30.9
 *   → 149 rows, header ZTIME,WSR_ID,CELL_ID,PROB,SEVPROB,MAXSIZE,LAT,LON
 *
 * WHAT THIS IS NOT. MEHS is a model's inference of the largest hail *aloft*,
 * not an observation of hail on the ground, and it over-predicts in the warm,
 * deep-moist environments this market sits in. Measured over the service-area
 * bbox for the 24 months to 2026-09-24: 1,265 cell-days at MEHS >= 1.0", of
 * which 12.6% had any NWS ground report within 15 km the same day. At 1.5" that
 * rises to 33.8%. That is why radar is counted separately from ground reports
 * everywhere in this product, never averaged into them, and why the engine
 * applies a higher size floor to radar than to reports.
 *
 * Attribution: NOAA/NCEI SWDI, U.S. Government work, public domain.
 */

const SWDI_BASE = 'https://www.ncei.noaa.gov/swdiws/csv/nx3hail'

/**
 * SWDI truncates a result set silently. Its `summary` trailer carries the true
 * count, so a run that hits the ceiling is reported rather than quietly short.
 */
const SWDI_RESULT_CEILING = 10_000

/**
 * A rep is waiting in a driveway. Four at a time keeps a 24-month pull around
 * ten seconds without hammering a public service.
 */
const MAX_CONCURRENT_REQUESTS = 4

/**
 * Grid resolution for collapsing scans into events, in degrees. ~2.2 km, close
 * to the 0.01° MRMS MESH grid this replaces and comfortably inside the ~4 km
 * radar sampling that produced the rows.
 */
const GRID_DEGREES = 0.02

export interface SwdiRow {
  readonly ztime: string
  readonly wsrId: string
  readonly cellId: string
  readonly maxSizeInches: number
  readonly latitude: number
  readonly longitude: number
  readonly severeProbability: number | null
}

/**
 * Splits a window into calendar months.
 *
 * Calendar months rather than fixed 31-day slices because SWDI's limit is 744
 * hours exactly and a slice that straddles a 31-day month plus an hour is
 * rejected with a validation error rather than a short answer.
 */
export function monthChunks(from: string, to: string): { from: Date; to: Date }[] {
  const start = new Date(from)
  const end = new Date(to)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) return []

  const chunks: { from: Date; to: Date }[] = []
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()))

  while (cursor <= end) {
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    const chunkEnd = new Date(Math.min(nextMonth.getTime() - 1, end.getTime()))
    chunks.push({ from: new Date(cursor), to: chunkEnd })
    cursor = nextMonth
  }
  return chunks
}

function yyyymmdd(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  )
}

export function swdiUrl(bbox: StormQuery['bbox'], from: Date, to: Date): string {
  const [west, south, east, north] = bbox
  // SWDI's bbox is west,south,east,north — the same order this codebase uses.
  return `${SWDI_BASE}/${yyyymmdd(from)}:${yyyymmdd(to)}?bbox=${west},${south},${east},${north}`
}

export class SwdiTruncatedError extends Error {}

/**
 * Parses an SWDI CSV body.
 *
 * Three shapes come back and all three are normal:
 *   - `summary\ncount,0\n…`           — no hail in the window
 *   - `error,ERROR VALIDATING …`      — a bad range, which is our bug
 *   - `ZTIME,WSR_ID,…` + rows + a trailing `summary` block
 * The trailing summary is not a data row and must not be parsed as one; the
 * first run of this parser without that guard produced NaN coordinates.
 */
export function parseSwdiCsv(body: string): { rows: SwdiRow[]; count: number } {
  const text = body.trim()
  if (text === '' || text.startsWith('summary')) return { rows: [], count: 0 }
  if (text.startsWith('error')) {
    throw new Error(`NOAA SWDI rejected the request: ${text.slice(0, 200)}`)
  }

  const lines = text.split(/\r?\n/)
  const header = (lines[0] ?? '').split(',')
  const col = (name: string) => header.indexOf(name)
  const iTime = col('ZTIME')
  const iSize = col('MAXSIZE')
  const iLat = col('LAT')
  const iLon = col('LON')
  if (iTime < 0 || iSize < 0 || iLat < 0 || iLon < 0) {
    throw new Error('NOAA SWDI returned a shape this app does not recognise.')
  }
  const iWsr = col('WSR_ID')
  const iCell = col('CELL_ID')
  const iSev = col('SEVPROB')

  const rows: SwdiRow[] = []
  let count = 0

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]
    if (!line) continue
    if (line.startsWith('summary')) {
      const countLine = lines[i + 1] ?? ''
      const parsed = Number.parseInt(countLine.split(',')[1] ?? '', 10)
      if (Number.isFinite(parsed)) count = parsed
      break
    }
    const parts = line.split(',')
    const latitude = Number.parseFloat(parts[iLat] ?? '')
    const longitude = Number.parseFloat(parts[iLon] ?? '')
    const maxSizeInches = Number.parseFloat(parts[iSize] ?? '')
    const ztime = parts[iTime] ?? ''
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue
    if (!Number.isFinite(maxSizeInches) || ztime === '') continue
    const severe = iSev >= 0 ? Number.parseInt(parts[iSev] ?? '', 10) : Number.NaN

    rows.push({
      ztime,
      wsrId: parts[iWsr] ?? '',
      cellId: parts[iCell] ?? '',
      maxSizeInches,
      latitude,
      longitude,
      severeProbability: Number.isFinite(severe) ? severe : null,
    })
  }

  return { rows, count: count || rows.length }
}

/**
 * Collapses raw detections into one event per place per day.
 *
 * A single storm cell is re-detected every volume scan, by every radar that can
 * see it — four radars covering Baton Rouge produced 4,217 rows for 24 months,
 * describing 87 hail days. Feeding those rows to the scorer would let one
 * afternoon's storm out-vote a year of weather purely by row count, and would
 * make the "storms considered" number meaningless.
 *
 * So this reduces to the same thing MRMS MESH_Max_1440min publishes directly:
 * the maximum estimated hail size at a location over a day. Ties keep the
 * earlier scan, so the id is stable across re-runs.
 */
export function collapseToDailyMax(rows: readonly SwdiRow[]): SwdiRow[] {
  const best = new Map<string, SwdiRow>()
  for (const row of rows) {
    const day = row.ztime.slice(0, 10)
    const key = `${day}|${Math.round(row.latitude / GRID_DEGREES)}|${Math.round(row.longitude / GRID_DEGREES)}`
    const seen = best.get(key)
    if (!seen || row.maxSizeInches > seen.maxSizeInches) best.set(key, row)
  }
  return [...best.values()]
}

function toStormEvent(row: SwdiRow): StormEvent {
  const day = row.ztime.slice(0, 10)
  const cellLat = Math.round(row.latitude / GRID_DEGREES)
  const cellLon = Math.round(row.longitude / GRID_DEGREES)
  return {
    // Stable and idempotent: the same day and grid square always produces the
    // same id, whichever radar happened to win the maximum on a given re-run.
    externalId: `nx3hail|${day}|${cellLat}|${cellLon}`,
    provider: 'swdi',
    eventType: 'hail',
    occurredAt: row.ztime,
    hailSizeInches: row.maxSizeInches,
    latitude: row.latitude,
    longitude: row.longitude,
    observation: 'radar_estimate',
    // Until a ground report is matched against it, radar stands alone. The
    // engine upgrades this where a report corroborates it.
    radarConfidence: 'radar_only',
    magnitudeNote:
      `Radar estimate (NEXRAD ${row.wsrId || 'Level-III'} hail detection), ` +
      'not an observation of hail on the ground.',
  }
}

/** Runs `worker` over `items`, at most `limit` in flight. */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      const item = items[index]
      if (item === undefined) return
      results[index] = await worker(item)
    }
  })
  await Promise.all(runners)
  return results
}

export class SwdiStormProvider implements StormProvider {
  readonly id = 'swdi' as const
  readonly displayName = 'NOAA radar-estimated hail (NEXRAD / SWDI)'
  readonly attribution =
    'Source: NOAA NCEI Severe Weather Data Inventory — NEXRAD Level-III hail detection (nx3hail), public domain'
  /** U.S. Government work. Safe to persist. */
  readonly mayPersistGeometry = true

  private readonly fetchImpl: typeof fetch

  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = boundFetch(fetchImpl)
  }

  async availability(): Promise<ProviderAvailability> {
    try {
      // One day, one degree. Cheap, and it exercises the real path including CORS.
      const res = await this.fetchImpl(
        swdiUrl([-91.5, 30.1, -90.5, 30.9], new Date('2026-05-08'), new Date('2026-05-08')),
        { method: 'GET' },
      )
      return res.ok
        ? { available: true }
        : {
            available: false,
            reason: `The NOAA radar hail service answered ${res.status}. Radar-estimated hail is temporarily unavailable.`,
            actionable: false,
          }
    } catch {
      return {
        available: false,
        reason:
          'No connection to the NOAA radar hail service. Radar-estimated hail will load when you are back online.',
        actionable: false,
      }
    }
  }

  async searchEvents(query: StormQuery): Promise<StormEvent[]> {
    if (query.eventTypes && !query.eventTypes.includes('hail')) return []

    const chunks = monthChunks(query.from, query.to)
    if (chunks.length === 0) return []

    const parsed = await mapWithLimit(chunks, MAX_CONCURRENT_REQUESTS, async (chunk) => {
      const res = await this.fetchImpl(swdiUrl(query.bbox, chunk.from, chunk.to), { method: 'GET' })
      if (!res.ok) throw new Error(`NOAA SWDI request failed with ${res.status}`)
      return parseSwdiCsv(await res.text())
    })

    const truncated = parsed.some((p) => p.count >= SWDI_RESULT_CEILING)
    const rows = parsed.flatMap((p) => p.rows)

    const events = collapseToDailyMax(rows)
      .map(toStormEvent)
      .filter((e) => {
        const at = new Date(e.occurredAt).getTime()
        if (!Number.isFinite(at)) return false
        // SWDI's range is whole days, so the edge months overshoot the window.
        if (at < new Date(query.from).getTime() || at > new Date(query.to).getTime()) return false
        if (query.minHailSizeInches === undefined) return true
        return (e.hailSizeInches ?? 0) >= query.minHailSizeInches
      })

    if (truncated) {
      // Thrown rather than returned short: a silently clipped storm list would
      // remove doors from a rep's day with nothing on screen to say so.
      throw new SwdiTruncatedError(
        'The NOAA radar hail service capped one month of this request. Narrow the area or the window.',
      )
    }

    return events
  }

  /**
   * A hail detection is a storm-cell centroid, not a footprint. There is no
   * authoritative polygon to hand back, and drawing one would imply a swath
   * boundary the data does not contain.
   */
  async eventGeometry(): Promise<StormGeometry | null> {
    return null
  }
}
