import { z } from 'zod'
import { boundFetch } from '@/lib/fetch'
import type {
  ProviderAvailability,
  StormEvent,
  StormEventType,
  StormGeometry,
  StormProvider,
  StormQuery,
} from './types'

/**
 * NOAA / NWS Local Storm Reports via the Iowa Environmental Mesonet (IEM)
 * GeoJSON service.
 *
 * Verified live on 2026-09-18 against:
 *   https://mesonet.agron.iastate.edu/geojson/lsr.py?sts=...&ets=...&states=...
 *
 * IEM republishes NWS Local Storm Reports, which are public domain. This is the
 * default provider precisely because it costs nothing and carries no licence
 * restriction: geometry and metadata may both be stored.
 *
 * Limitation worth being honest about: LSRs are *reports* (spotters, public,
 * trained observers), not radar-derived swaths. They under-represent hail in
 * areas nobody reported from. That is acceptable for prospecting, and is exactly
 * the gap a paid provider like HailTrace would fill.
 */

const IEM_LSR_URL = 'https://mesonet.agron.iastate.edu/geojson/lsr.py'

const lsrFeatureSchema = z.object({
  properties: z.object({
    valid: z.string(),
    typetext: z.string(),
    magnitude: z.union([z.string(), z.number(), z.null()]).optional(),
    unit: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    county: z.string().nullable().optional(),
    st: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    remark: z.string().nullable().optional(),
    product_id: z.string().nullable().optional(),
    lat: z.number(),
    lon: z.number(),
  }),
})

const lsrResponseSchema = z.object({
  type: z.literal('FeatureCollection'),
  // Unknown feature shapes are skipped rather than failing the whole request:
  // one malformed report must not blank the map.
  features: z.array(z.unknown()),
})

/** Maps NWS report type text onto our event taxonomy. */
function classify(typetext: string): StormEventType | null {
  const t = typetext.toUpperCase()
  if (t.includes('HAIL')) return 'hail'
  if (t.includes('TORNADO')) return 'tornado'
  if (t.includes('WND') || t.includes('WIND')) return 'wind'
  return null
}

function parseMagnitude(raw: unknown): number | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined
  const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
  return Number.isFinite(n) ? n : undefined
}

/**
 * IEM's LSR service filters by state, not bbox, so we request the states the
 * bounding box touches and filter to the box client-side. For Delta Ridge's
 * market that is almost always a single request for 'LA'.
 */
function statesForBbox(bbox: StormQuery['bbox']): string[] {
  const [west, south, east, north] = bbox
  // Coarse envelopes for the Gulf South plus neighbours. Intentionally generous:
  // a superfluous state costs one filtered row, a missing one loses real reports.
  const envelopes: Array<{ st: string; w: number; s: number; e: number; n: number }> = [
    { st: 'LA', w: -94.1, s: 28.9, e: -88.7, n: 33.1 },
    { st: 'MS', w: -91.7, s: 30.1, e: -88.0, n: 35.1 },
    { st: 'TX', w: -106.7, s: 25.8, e: -93.4, n: 36.6 },
    { st: 'AR', w: -94.7, s: 32.9, e: -89.6, n: 36.6 },
    { st: 'AL', w: -88.5, s: 30.1, e: -84.8, n: 35.1 },
  ]
  const hits = envelopes
    .filter((b) => west <= b.e && east >= b.w && south <= b.n && north >= b.s)
    .map((b) => b.st)
  return hits.length > 0 ? hits : ['LA']
}

function withinBbox(lat: number, lon: number, bbox: StormQuery['bbox']): boolean {
  const [west, south, east, north] = bbox
  return lon >= west && lon <= east && lat >= south && lat <= north
}

/**
 * Builds a stable identity for a Local Storm Report.
 *
 * NWS product ids are per-*product*, not per-report: a single LSR bulletin
 * carries many reports and they all share one product_id. Keying on it alone
 * silently collapses distinct reports, which would then be skipped by the
 * database's unique (provider, external_id) constraint. Verified against live
 * IEM data on 2026-09-18.
 */
function buildExternalId(parts: {
  productId: string | null
  valid: string
  lat: number
  lon: number
  typetext: string
  magnitude: string | number | null
  remark: string | null
}): string {
  const magnitude =
    parts.magnitude === null || parts.magnitude === '' ? '-' : String(parts.magnitude)
  return [
    parts.productId ?? 'lsr',
    parts.valid,
    `${parts.lat.toFixed(4)},${parts.lon.toFixed(4)}`,
    parts.typetext,
    magnitude,
    fingerprintRemark(parts.remark),
  ].join('|')
}

/**
 * Short, stable fingerprint of a report's remark text.
 *
 * Needed because two genuinely different reports routinely share a product, a
 * timestamp and rounded coordinates — verified on live data: two separate
 * "tree down" reports in Diamondhead on different streets, and a correction
 * bulletin superseding an earlier report at the same spot. The remark is what
 * actually distinguishes them.
 *
 * Whitespace is normalised and case folded first, so a report reissued with only
 * a trailing space collapses to the same id and is correctly treated as one
 * event rather than two.
 *
 * FNV-1a: not cryptographic, and does not need to be. It needs to be stable
 * across runs and cheap, both of which it is.
 */
function fingerprintRemark(remark: string | null): string {
  const normalised = (remark ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
  if (normalised === '') return '-'
  let hash = 0x811c9dc5
  for (let i = 0; i < normalised.length; i += 1) {
    hash ^= normalised.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export class NoaaStormProvider implements StormProvider {
  readonly id = 'noaa' as const
  readonly displayName = 'NOAA / NWS Storm Reports'
  readonly attribution =
    'Source: NOAA National Weather Service Local Storm Reports via Iowa Environmental Mesonet (public domain)'
  /** Public domain: safe to persist. */
  readonly mayPersistGeometry = true

  private readonly fetchImpl: typeof fetch

  // Bound, never stored raw. See src/lib/fetch.ts.
  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = boundFetch(fetchImpl)
  }

  async availability(): Promise<ProviderAvailability> {
    // No credential required. Report a transport problem honestly rather than
    // claiming unavailability the operator could fix.
    try {
      const url = new URL(IEM_LSR_URL)
      url.searchParams.set('sts', '2026-01-01T00:00Z')
      url.searchParams.set('ets', '2026-01-01T01:00Z')
      url.searchParams.set('states', 'LA')
      const res = await this.fetchImpl(url, { method: 'GET' })
      return res.ok
        ? { available: true }
        : {
            available: false,
            reason: `NOAA storm report service returned ${res.status}. Storm history is temporarily unavailable.`,
            actionable: false,
          }
    } catch {
      return {
        available: false,
        reason: 'No connection to the NOAA storm report service. Storm history will load when you are back online.',
        actionable: false,
      }
    }
  }

  async searchEvents(query: StormQuery): Promise<StormEvent[]> {
    const url = new URL(IEM_LSR_URL)
    url.searchParams.set('sts', query.from)
    url.searchParams.set('ets', query.to)
    url.searchParams.set('states', statesForBbox(query.bbox).join(','))

    const res = await this.fetchImpl(url, { method: 'GET' })
    if (!res.ok) {
      throw new Error(`NOAA storm report request failed with ${res.status}`)
    }

    const body = lsrResponseSchema.parse(await res.json())
    const events: StormEvent[] = []

    for (const rawFeature of body.features) {
      const parsed = lsrFeatureSchema.safeParse(rawFeature)
      if (!parsed.success) continue

      const p = parsed.data.properties
      const eventType = classify(p.typetext)
      if (!eventType) continue
      if (query.eventTypes && !query.eventTypes.includes(eventType)) continue
      if (!withinBbox(p.lat, p.lon, query.bbox)) continue

      const magnitude = parseMagnitude(p.magnitude)
      const unit = (p.unit ?? '').toUpperCase()
      const hailSizeInches =
        eventType === 'hail' && magnitude !== undefined && (unit === '' || unit.startsWith('INCH'))
          ? magnitude
          : undefined
      const windSpeedMph =
        eventType === 'wind' && magnitude !== undefined && (unit === '' || unit.startsWith('MPH'))
          ? Math.round(magnitude)
          : undefined

      if (query.minHailSizeInches !== undefined) {
        if (hailSizeInches === undefined || hailSizeInches < query.minHailSizeInches) continue
      }

      events.push({
        // Stable, collision-free id. An LSR product_id is shared by every report
        // in that product, so it cannot stand alone as a key — verified against
        // live data on 2026-09-18, where product_id + coords + type produced
        // duplicates. The report's valid time and magnitude disambiguate.
        externalId: buildExternalId({
          productId: p.product_id ?? null,
          valid: p.valid,
          lat: p.lat,
          lon: p.lon,
          typetext: p.typetext,
          magnitude: p.magnitude ?? null,
          remark: p.remark ?? null,
        }),
        provider: 'noaa',
        eventType,
        occurredAt: p.valid,
        ...(hailSizeInches !== undefined ? { hailSizeInches } : {}),
        ...(windSpeedMph !== undefined ? { windSpeedMph } : {}),
        latitude: p.lat,
        longitude: p.lon,
        ...(p.city ? { city: p.city } : {}),
        ...(p.county ? { countyParish: p.county } : {}),
        ...(p.st ?? p.state ? { state: (p.st ?? p.state) as string } : {}),
        ...(p.remark ? { magnitudeNote: p.remark } : {}),
      })
    }

    // Collapse true repeats. After fingerprinting, an identical id means the
    // same report was carried twice in the feed; the caller should see it once,
    // and the database's unique (provider, external_id) constraint depends on it.
    const deduped = new Map<string, StormEvent>()
    for (const event of events) {
      if (!deduped.has(event.externalId)) deduped.set(event.externalId, event)
    }
    return [...deduped.values()]
  }

  /**
   * Local Storm Reports are points, not swaths. Returning null is the honest
   * answer: there is no authoritative affected-area polygon to draw. The map
   * renders graduated point clusters for this provider instead of faking a
   * footprint, because a drawn polygon implies coverage we cannot support.
   */
  async eventGeometry(): Promise<StormGeometry | null> {
    return null
  }
}
