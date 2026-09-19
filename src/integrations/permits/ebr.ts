import { z } from 'zod'
import { normalizeAddress } from '@/lib/address'
import type { ProviderAvailability } from '@/integrations/storm/types'
import type { PermitKind, PermitProvider, PermitQuery, PermitRecord } from './types'

/**
 * East Baton Rouge Parish building permits, via the parish's Socrata endpoint.
 *
 * Verified live on 2026-09-19 against
 * https://data.brla.gov/resource/7fq7-8j7r.json :
 *
 *   * `Re-Roof (R)` and `Re-Roof (C)` are distinct, queryable permit types.
 *   * Records run 2011-10-10 to 2026-09-04 — it is a live feed, not a dump.
 *   * 1,751 re-roof and 9,282 residential new-build permits carry coordinates.
 *   * `Access-Control-Allow-Origin: *`, so the browser can call this directly
 *     and the whole lead engine needs no server and no API key.
 *
 * Known limitation, stated rather than papered over: not every permit has
 * coordinates, and a roof replaced without a permit leaves no trace at all.
 * Suppression reduces wasted doors; it does not eliminate them.
 */

const ENDPOINT = 'https://data.brla.gov/resource/7fq7-8j7r.json'

/** The parish's own wording. Matching on these exactly is the contract. */
const REROOF_TYPES = ['Re-Roof (R)', 'Re-Roof (C)']
const NEW_BUILD_TYPES = ['New Building Permit (R)']

/**
 * Socrata returns numbers as strings often enough that coercing is the honest
 * default. A row that cannot be understood is dropped, never guessed at.
 */
const rowSchema = z.object({
  permitid: z.union([z.string(), z.number()]).optional(),
  permitnumber: z.string().optional(),
  permittype: z.string(),
  issueddate: z.string().optional(),
  creationdate: z.string().optional(),
  address: z.string().optional(),
  streetaddress: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  projectvalue: z.union([z.string(), z.number()]).optional(),
  contractorname: z.string().optional(),
  ownername: z.string().optional(),
  subdivision: z.string().optional(),
  lat: z.union([z.string(), z.number()]).optional(),
  long: z.union([z.string(), z.number()]).optional(),
})

function num(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

export function classifyPermitType(permitType: string): PermitKind {
  if (REROOF_TYPES.includes(permitType)) return 'reroof'
  if (NEW_BUILD_TYPES.includes(permitType)) return 'new_build'
  return 'other'
}

function quote(values: string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ')
}

/** Builds the SoQL `$where` clause for a query. Exported so it can be tested. */
export function buildWhere(query: PermitQuery): string {
  const clauses: string[] = []

  const types: string[] = []
  if (query.kinds.includes('reroof')) types.push(...REROOF_TYPES)
  if (query.kinds.includes('new_build')) types.push(...NEW_BUILD_TYPES)
  if (types.length > 0) clauses.push(`permittype in (${quote(types)})`)

  if (query.issuedFrom) clauses.push(`issueddate >= '${query.issuedFrom}'`)
  if (query.issuedTo) clauses.push(`issueddate <= '${query.issuedTo}'`)

  if (query.bbox) {
    const [west, south, east, north] = query.bbox
    // Coordinates are text columns on this dataset, so they are cast rather
    // than compared as strings — a string comparison would silently return
    // nonsense for negative longitudes.
    clauses.push(
      `lat IS NOT NULL AND long IS NOT NULL`,
      `(lat::number) between ${south} and ${north}`,
      `(long::number) between ${west} and ${east}`,
    )
  }

  return clauses.join(' AND ')
}

export class EbrPermitProvider implements PermitProvider {
  readonly id = 'ebr' as const
  readonly displayName = 'East Baton Rouge Parish permits'
  readonly attribution = 'City of Baton Rouge / East Baton Rouge Parish Open Data'
  readonly coverage =
    'East Baton Rouge Parish only. Ascension has required re-roof permits since August 2025 but publishes no public feed yet; Livingston is view-only.'

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async availability(): Promise<ProviderAvailability> {
    try {
      const res = await this.fetchImpl(`${ENDPOINT}?$limit=1`)
      if (!res.ok) {
        return {
          available: false,
          reason: `The parish permit service answered ${res.status}. Lead scoring will fall back to storm data alone.`,
          actionable: false,
        }
      }
      return { available: true }
    } catch {
      return {
        available: false,
        // A rep offline on a roof must read this as normal, not as breakage.
        reason: 'No connection to the parish permit service. Any leads already downloaded are still here.',
        actionable: false,
      }
    }
  }

  async search(query: PermitQuery): Promise<PermitRecord[]> {
    const params = new URLSearchParams()
    const where = buildWhere(query)
    if (where) params.set('$where', where)
    params.set('$limit', String(Math.min(query.limit ?? 2000, 50000)))
    params.set('$order', 'issueddate DESC')

    const res = await this.fetchImpl(`${ENDPOINT}?${params.toString()}`)
    if (!res.ok) throw new Error(`Permit service returned ${res.status}`)
    const body: unknown = await res.json()
    if (!Array.isArray(body)) throw new Error('Permit service returned an unexpected shape')

    const out: PermitRecord[] = []
    for (const raw of body) {
      const parsed = rowSchema.safeParse(raw)
      if (!parsed.success) continue
      const r = parsed.data
      const issuedAt = r.issueddate ?? r.creationdate
      const address = r.address ?? r.streetaddress
      if (!issuedAt || !address) continue

      const lat = num(r.lat)
      const lon = num(r.long)
      const value = num(r.projectvalue)

      out.push({
        externalId: String(r.permitid ?? r.permitnumber ?? `${address}:${issuedAt}`),
        provider: 'ebr',
        kind: classifyPermitType(r.permittype),
        permitType: r.permittype,
        issuedAt,
        address,
        addressKey: normalizeAddress(address),
        ...(r.city ? { city: r.city } : {}),
        ...(r.zip ? { postalCode: r.zip } : {}),
        ...(lat !== undefined ? { latitude: lat } : {}),
        ...(lon !== undefined ? { longitude: lon } : {}),
        ...(value !== undefined ? { projectValue: value } : {}),
        ...(r.contractorname ? { contractorName: r.contractorname } : {}),
        ...(r.ownername ? { ownerName: r.ownername } : {}),
        ...(r.subdivision ? { subdivision: r.subdivision } : {}),
      })
    }
    return out
  }
}
