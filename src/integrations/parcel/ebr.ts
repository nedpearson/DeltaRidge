import { z } from 'zod'
import { normalizeAddress } from '@/lib/address'
import { boundFetch } from '@/lib/fetch'
import type { ProviderAvailability } from '@/integrations/storm/types'
import type {
  OccupancyBasis,
  OccupancyStatus,
  OwnerKind,
  ParcelProvider,
  ParcelQuery,
  ParcelRecord,
} from './types'

/**
 * East Baton Rouge Parish tax parcels, via the parish's own ArcGIS service.
 *
 * Verified live on 2026-09-23 against
 *   https://maps.brla.gov/gis/rest/services/Cadastral/Tax_Parcel/MapServer/0
 * 205,820 parcels. Free, keyless, CORS-open, public record.
 *
 * Measured fill rates over a 2,000-parcel sample, so nothing below is assumed:
 *
 *   OWNER                    100%
 *   OWNER_ADDRESS             99%
 *   OWNER_CITY_STATE_ZIP      99%
 *   SUBDIVISION               99%
 *   ASSESSMENT_NUM           100%
 *   FLOOD_ZONE               100%
 *   SUM_ASSESSED_VALUE       100%
 *   SUM_LAND_VALUE           100%
 *   SUM_HOMESTEAD_EXEMPTION   63%   <- the owner-occupied signal
 *   SUM_IMPROVEMENT_VALUE      0%   <- column exists, never populated
 *   SUM_FAIR_MARKET_VALUE      0%   <- column exists, never populated
 *
 * The two zero-fill columns are the reason this provider exposes `assessedValue`
 * and nothing else. An earlier plan scored leads on an improvement-value band;
 * that field is empty on every record in the parish and the plan was wrong.
 */

const ENDPOINT =
  'https://maps.brla.gov/gis/rest/services/Cadastral/Tax_Parcel/MapServer/0/query'

/**
 * Every field we are willing to ask for — and SALE_YEAR is deliberately absent.
 *
 * THE TRAP: including SALE_YEAR in `outFields` makes the service return a
 * perfectly well-formed response with `features: []`. No error, no HTTP status,
 * no warning. Bisected field by field on 2026-09-23 against a query whose true
 * result is 32 rows: every other column returns 32, SALE_YEAR returns 0, and
 * `outFields=*` — which includes it — returns 0 for the whole parish.
 *
 * So the parcel layer cannot supply sale history at all, and asking for it
 * silently deletes the owner data as well. That is why this list is explicit
 * and why `outFields=*` must never be used here.
 */
const OUT_FIELDS = [
  'ASSESSMENT_NUM',
  'PRONO',
  'OWNER',
  'OWNER_ADDRESS',
  'OWNER_CITY_STATE_ZIP',
  'PHYSICAL_ADDRESS',
  'SUBDIVISION',
  'WARD_SECTION',
  'LOT',
  'BLOCK',
  'LEGAL_DESCRIPTION',
  'FLOOD_ZONE',
  'STATUS',
  'SUM_HOMESTEAD_EXEMPTION',
  'SUM_LAND_VALUE',
  'SUM_ASSESSED_VALUE',
] as const

/** Named so a future edit cannot quietly re-add it. */
export const POISONED_FIELDS = ['SALE_YEAR'] as const

/**
 * Addresses per batched lookup.
 *
 * A hundred keeps each POST body around three kilobytes and one failure cheap
 * to retry. Four hundred candidate addresses cost four requests.
 */
export const ADDRESS_BATCH_SIZE = 100

/** Batches in flight at once. Enough to be quick, few enough to be polite. */
export const LOOKUP_CONCURRENCY = 4

export function chunkAddresses(items: readonly string[], size = ADDRESS_BATCH_SIZE): string[][] {
  const out: string[][] = []
  for (let i = 0; i < items.length; i += size) out.push([...items.slice(i, i + size)])
  return out
}

const attributesSchema = z.object({
  ASSESSMENT_NUM: z.string().nullable().optional(),
  PRONO: z.number().nullable().optional(),
  OWNER: z.string().nullable().optional(),
  OWNER_ADDRESS: z.string().nullable().optional(),
  OWNER_CITY_STATE_ZIP: z.string().nullable().optional(),
  PHYSICAL_ADDRESS: z.string().nullable().optional(),
  SUBDIVISION: z.string().nullable().optional(),
  LOT: z.string().nullable().optional(),
  BLOCK: z.string().nullable().optional(),
  LEGAL_DESCRIPTION: z.string().nullable().optional(),
  FLOOD_ZONE: z.string().nullable().optional(),
  STATUS: z.string().nullable().optional(),
  SUM_HOMESTEAD_EXEMPTION: z.number().nullable().optional(),
  SUM_LAND_VALUE: z.number().nullable().optional(),
  SUM_ASSESSED_VALUE: z.number().nullable().optional(),
})

const featureSchema = z.object({
  attributes: attributesSchema,
  geometry: z
    .object({ rings: z.array(z.array(z.array(z.number()))) })
    .nullable()
    .optional(),
})

const responseSchema = z.object({
  // One malformed parcel must not blank the street.
  features: z.array(z.unknown()).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  exceededTransferLimit: z.boolean().optional(),
})

/**
 * Classifies the owner string the parish recorded.
 *
 * This exists because "S & L THOMAS LIVING TRUST DATED FEBRUARY 27, 2023" is a
 * real owner on a real Baton Rouge street, and a rep who walks up expecting to
 * greet Mr Thomas is starting the conversation wrong. It also keeps the app
 * from ever splitting an entity name into a first and last name.
 *
 * Deliberately conservative: anything not clearly an entity stays `person`,
 * and nothing here is shown as a fact about the occupant.
 */
export function classifyOwner(name: string): OwnerKind {
  const n = name.toUpperCase()
  if (/\b(CITY|PARISH|STATE OF|UNITED STATES|SCHOOL BOARD|AUTHORITY)\b/.test(n)) return 'government'
  if (/\bTRUST\b|\bTRUSTEE\b|\bESTATE OF\b|\bSUCCESSION\b/.test(n)) return 'trust'
  if (/\b(LLC|L\.L\.C|INC|CORP|CO|COMPANY|LP|LLP|PARTNERSHIP|PROPERTIES|HOLDINGS|CHURCH)\b/.test(n))
    return 'company'
  if (n.trim() === '') return 'unknown'
  return 'person'
}

/**
 * Decides occupancy, and says on what basis.
 *
 * Order matters. A homestead exemption is a filing the owner made under oath
 * to claim a primary residence, so it outranks an address comparison. Only when
 * there is no exemption on the roll do we fall back to comparing the tax-bill
 * address with the property address — and a mismatch there is reported as
 * "likely absentee", never as absentee, because a PO box is not a tenant.
 */
export function decideOccupancy(input: {
  homesteadExemption?: number | null | undefined
  ownerMailingAddress?: string | null | undefined
  propertyAddress?: string | null | undefined
}): { occupancy: OccupancyStatus; basis: OccupancyBasis } {
  if ((input.homesteadExemption ?? 0) > 0) {
    return { occupancy: 'owner_occupied', basis: 'homestead_exemption' }
  }

  // Trimmed first, deliberately. `normalizeAddress` mirrors a Postgres
  // generated column that collapses whitespace runs but does NOT trim, and the
  // parish stores the mailing address with a leading space — " 18834 SANTA
  // MARIA PKWY" — so comparing the two unnormalised strings reports an owner
  // who lives in the house as an absentee.
  const mailing = normalizeAddress((input.ownerMailingAddress ?? '').trim())
  const situs = normalizeAddress((input.propertyAddress ?? '').trim())
  if (!mailing || !situs) return { occupancy: 'unknown', basis: 'unknown' }

  return mailing === situs
    ? { occupancy: 'owner_occupied', basis: 'mailing_matches' }
    : { occupancy: 'likely_absentee', basis: 'mailing_differs' }
}

/** Ring centroid. Good enough to centre a satellite tile on the house. */
function ringCentroid(
  ring: ReadonlyArray<readonly number[]>,
): { lon: number; lat: number } | null {
  if (ring.length === 0) return null
  let sx = 0
  let sy = 0
  let n = 0
  for (const point of ring) {
    const [x, y] = point
    if (typeof x !== 'number' || typeof y !== 'number') continue
    sx += x
    sy += y
    n += 1
  }
  return n === 0 ? null : { lon: sx / n, lat: sy / n }
}

/** ArcGIS string literals are single-quoted; a quote in the value ends it. */
function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildWhere(query: ParcelQuery): string {
  const clauses: string[] = []
  if (query.addressLike) {
    clauses.push(`PHYSICAL_ADDRESS LIKE ${sqlQuote(`%${query.addressLike.toUpperCase()}%`)}`)
  }
  if (query.parcelNumbers && query.parcelNumbers.length > 0) {
    clauses.push(`ASSESSMENT_NUM IN (${query.parcelNumbers.map(sqlQuote).join(',')})`)
  }
  return clauses.length > 0 ? clauses.join(' AND ') : 'PHYSICAL_ADDRESS IS NOT NULL'
}

export class EbrParcelProvider implements ParcelProvider {
  readonly id = 'ebr' as const
  readonly displayName = 'East Baton Rouge Parish Assessor'
  readonly attribution =
    'Source: East Baton Rouge Parish tax parcel records (public record, City-Parish GIS)'
  readonly coverage = 'East Baton Rouge Parish only. Ascension and Livingston are not covered.'
  /** Public record: safe to store, with no contractual cache clock. */
  readonly mayPersist = true

  private readonly fetchImpl: typeof fetch

  // Bound, never stored raw. See src/lib/fetch.ts.
  constructor(fetchImpl: typeof fetch = globalThis.fetch) {
    this.fetchImpl = boundFetch(fetchImpl)
  }

  async availability(): Promise<ProviderAvailability> {
    try {
      const url = new URL(ENDPOINT)
      url.searchParams.set('where', '1=1')
      url.searchParams.set('returnCountOnly', 'true')
      url.searchParams.set('f', 'json')
      const res = await this.fetchImpl(url, { method: 'GET' })
      return res.ok
        ? { available: true }
        : {
            available: false,
            reason: `The parish parcel service returned ${res.status}. Owner records are temporarily unavailable.`,
            actionable: false,
          }
    } catch {
      return {
        available: false,
        reason:
          'No connection to the parish parcel service. Owner records will load when you are back online.',
        actionable: false,
      }
    }
  }

  /**
   * One POST, always.
   *
   * A GET carries the whole `where` clause in the URL, and a batch of a hundred
   * addresses builds a clause of two to three kilobytes. The parish answers
   * that with a bare **404** — not a 414, not an ArcGIS error object, just a
   * missing page, which reads like a wrong endpoint rather than a long URL.
   * Verified on 2026-09-23: the same clause POSTed as form data succeeds, and
   * the response still echoes the caller's Origin, so the browser is happy.
   */
  private async query(params: Record<string, string>): Promise<unknown> {
    const body = new URLSearchParams({ f: 'json', ...params })
    const res = await this.fetchImpl(ENDPOINT, {
      method: 'POST',
      // A simple content type on purpose: no CORS preflight to negotiate.
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      throw new Error(`Parish parcel request failed with ${res.status}`)
    }
    return res.json()
  }

  async search(query: ParcelQuery): Promise<ParcelRecord[]> {
    const params: Record<string, string> = {
      where: buildWhere(query),
      outFields: OUT_FIELDS.join(','),
      returnGeometry: query.includeGeometry ? 'true' : 'false',
    }
    if (query.includeGeometry) params.outSR = '4326'
    if (query.bbox) {
      const [west, south, east, north] = query.bbox
      params.geometry = `${west},${south},${east},${north}`
      params.geometryType = 'esriGeometryEnvelope'
      params.inSR = '4326'
      params.spatialRel = 'esriSpatialRelIntersects'
    }
    if (query.limit !== undefined) params.resultRecordCount = String(query.limit)

    return this.toRecords(await this.query(params))
  }

  /**
   * Owner and coordinates for a known list of street addresses.
   *
   * This is the call that changes the shape of the lead engine. The parish
   * permit feed only began carrying lat/long around 2016, so finding roofs old
   * enough to sell meant geocoding thousands of addresses one capped batch at a
   * time. The parcel roll answers the same question — where is this house —
   * and hands over the owner, the homestead exemption and the assessed value in
   * the same response.
   *
   * Measured on 400 real pre-2014 residential build-permit addresses:
   * **86% matched, in 4 requests**, all 344 matches carrying parcel geometry
   * and 81% carrying a homestead exemption. The geocoder stays for the other
   * 14%, which are genuinely absent from the roll — addresses the parish does
   * not have rather than addresses we failed to spell.
   *
   * Addresses must already be street lines. Pass a permit's full address with
   * its city/state/ZIP tail and nothing will match; `streetLineOf` exists for
   * exactly that.
   */
  async lookupByAddresses(
    streetLines: readonly string[],
    options: { batchSize?: number; concurrency?: number } = {},
  ): Promise<Map<string, ParcelRecord>> {
    const wanted = [...new Set(streetLines.map((a) => a.trim().toUpperCase()).filter(Boolean))]
    const out = new Map<string, ParcelRecord>()
    if (wanted.length === 0) return out

    const batches = chunkAddresses(wanted, options.batchSize ?? ADDRESS_BATCH_SIZE)
    const concurrency = options.concurrency ?? LOOKUP_CONCURRENCY

    // Batches run a few at a time. Twenty of them in series took 31 seconds
    // against the live service, which is a rep staring at a spinner in a
    // driveway; four at a time is a quarter of that and still polite to a
    // parish server. Results are merged in batch order afterwards so
    // first-wins stays deterministic however the requests interleave.
    const results: ParcelRecord[][] = new Array(batches.length).fill(null)
    let next = 0
    async function worker(self: EbrParcelProvider) {
      for (;;) {
        const index = next
        next += 1
        const batch = batches[index]
        if (!batch) return
        const where = `PHYSICAL_ADDRESS IN (${batch.map(sqlQuote).join(',')})`
        results[index] = self.toRecords(
          await self.query({
            where,
            outFields: OUT_FIELDS.join(','),
            returnGeometry: 'true',
            outSR: '4326',
          }),
        )
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, batches.length) }, () => worker(this)),
    )

    for (const records of results) {
      for (const record of records ?? []) {
        // One address can carry several parcels — 2136 LOBDELL BLVD returns
        // two. First wins rather than last, so a re-run is stable.
        const key = record.address.trim().toUpperCase()
        if (!out.has(key)) out.set(key, record)
      }
    }
    return out
  }

  private toRecords(raw: unknown): ParcelRecord[] {
    const body = responseSchema.parse(raw)
    if (body.error) {
      throw new Error(`Parish parcel service error: ${body.error.message ?? 'unspecified'}`)
    }

    const retrievedAt = new Date().toISOString()
    const records: ParcelRecord[] = []

    for (const rawFeature of body.features ?? []) {
      const parsed = featureSchema.safeParse(rawFeature)
      if (!parsed.success) continue

      const a = parsed.data.attributes
      const ownerName = (a.OWNER ?? '').trim()
      const address = (a.PHYSICAL_ADDRESS ?? '').trim()
      // A parcel with no owner and no address cannot be knocked on or matched.
      if (ownerName === '' || address === '') continue

      const parcelNumber = (a.ASSESSMENT_NUM ?? '').trim() || String(a.PRONO ?? '')
      const mailing = (a.OWNER_ADDRESS ?? '').trim()
      const { occupancy, basis } = decideOccupancy({
        homesteadExemption: a.SUM_HOMESTEAD_EXEMPTION,
        ownerMailingAddress: mailing,
        propertyAddress: address,
      })

      const ring = parsed.data.geometry?.rings?.[0]
      const centroid = ring ? ringCentroid(ring) : null

      records.push({
        externalId: `ebr:${parcelNumber}`,
        provider: 'ebr',
        parcelNumber,
        address,
        addressKey: normalizeAddress(address) || null,
        parish: 'East Baton Rouge',
        ownerName,
        ownerKind: classifyOwner(ownerName),
        // The parish roll IS the record of ownership, matched on its own
        // parcel number. Nothing about this match is fuzzy.
        ownerConfidence: 'high',
        ...(mailing ? { ownerMailingAddress: mailing } : {}),
        ...(a.OWNER_CITY_STATE_ZIP
          ? { ownerMailingCityStateZip: a.OWNER_CITY_STATE_ZIP.trim() }
          : {}),
        occupancy,
        occupancyBasis: basis,
        ...(a.SUM_HOMESTEAD_EXEMPTION ? { homesteadExemption: a.SUM_HOMESTEAD_EXEMPTION } : {}),
        ...(a.SUBDIVISION ? { subdivision: a.SUBDIVISION.trim() } : {}),
        ...(a.LOT ? { lot: a.LOT.trim() } : {}),
        ...(a.BLOCK ? { block: a.BLOCK.trim() } : {}),
        ...(a.LEGAL_DESCRIPTION ? { legalDescription: a.LEGAL_DESCRIPTION.trim() } : {}),
        ...(a.FLOOD_ZONE ? { floodZone: a.FLOOD_ZONE.trim() } : {}),
        ...(a.SUM_ASSESSED_VALUE ? { assessedValue: a.SUM_ASSESSED_VALUE } : {}),
        ...(a.SUM_LAND_VALUE ? { landValue: a.SUM_LAND_VALUE } : {}),
        ...(centroid ? { latitude: centroid.lat, longitude: centroid.lon } : {}),
        ...(ring
          ? {
              boundary: ring
                .filter((p): p is [number, number] => p.length >= 2)
                .map((p) => [p[0], p[1]] as const),
            }
          : {}),
        retrievedAt,
      })
    }

    return records
  }
}
