import { z } from 'zod'

/**
 * East Baton Rouge Parish address locator.
 *
 * This exists because of a gap in the permit feed that would otherwise gut the
 * lead engine: the parish only began populating `lat`/`long` on permits around
 * 2016. Filtering permits to "issued before 2015" — which is how you find a
 * roof old enough to sell — leaves **13** records with usable coordinates out
 * of **2,327**. Geocoding the rest turns a useless list into a real one.
 *
 * Verified live on 2026-09-19 against
 * https://maps.brla.gov/gis/rest/services/EBRP_Point_Address_Locator/GeocodeServer
 * (locator last updated 15 March 2026):
 *
 *   * `/geocodeAddresses` batch works with no token.
 *   * `outSR=4326` returns lon/lat; without it the service answers in Louisiana
 *     State Plane feet, which silently produces nonsense distances.
 *   * The service echoes the caller's Origin in Access-Control-Allow-Origin, so
 *     the deployed app can call it from the browser.
 *   * The single-address form needs the `Street` field. `SingleLine` returns
 *     zero candidates without erroring — a silent empty result that looks
 *     exactly like "no such address".
 */

const ROOT = 'https://maps.brla.gov/gis/rest/services/EBRP_Point_Address_Locator/GeocodeServer'

/** Below this the match is a street interpolation or the wrong block. */
export const MIN_MATCH_SCORE = 85

/** The service accepts large batches; this keeps one failure cheap to retry. */
const BATCH_SIZE = 100

export interface GeocodeResult {
  latitude: number
  longitude: number
  score: number
  matchedAddress: string
}

const locationSchema = z.object({
  address: z.string().optional(),
  score: z.number().optional(),
  location: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
  attributes: z.object({ ResultID: z.union([z.number(), z.string()]).optional() }).partial().optional(),
})

const batchSchema = z.object({ locations: z.array(z.unknown()).optional() })

export function chunk<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Strips the city/state/ZIP tail the permit feed appends, because the locator
 * matches best on the street line alone. "3243 TIMBER GROVE DR  BATON ROUGE LA
 * 70816" becomes "3243 TIMBER GROVE DR".
 */
const CITY_TAIL =
  /\s+(BATON ROUGE|ZACHARY|CENTRAL|BAKER|PRIDE|GREENWELL SPRINGS|DENHAM SPRINGS|GONZALES|PRAIRIEVILLE|WALKER|SAINT GABRIEL|ST GABRIEL)$/i

export function streetLineOf(address: string): string {
  let s = address.replace(/\s+/g, ' ').trim()
  // Peeled off the END, one layer at a time, rather than cut at the first
  // city name found. Cutting at the first match destroys every address whose
  // STREET is named after a town — "37161 GREENWELL SPRINGS RD GREENWELL
  // SPRINGS LA" became "37161", which geocodes to nothing. Greenwell Springs
  // is real Delta Ridge territory, so that bug would have silently deleted a
  // whole corridor from the door list.
  s = s.replace(/\s+\d{5}(-\d{4})?$/, '')
  s = s.replace(/\s+(LA|LOUISIANA)$/i, '')
  s = s.replace(CITY_TAIL, '')
  return s.trim()
}

export class EbrGeocoder {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  /**
   * Geocodes a batch. Returns a map keyed by the caller's own index so a
   * partial response — the service may omit or fail individual rows — cannot
   * shift results onto the wrong address.
   */
  async geocodeBatch(addresses: string[]): Promise<Map<number, GeocodeResult>> {
    const out = new Map<number, GeocodeResult>()
    if (addresses.length === 0) return out

    const records = addresses.map((address, index) => ({
      attributes: { OBJECTID: index, Street: streetLineOf(address) },
    }))

    const body = new URLSearchParams({
      addresses: JSON.stringify({ records }),
      outSR: '4326',
      f: 'json',
    })

    // POST, not GET — see the note at the top of this file. A batch of a
    // hundred addresses does not fit in a URL.
    const res = await this.fetchImpl(`${ROOT}/geocodeAddresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) throw new Error(`Address locator returned ${res.status}`)
    const parsed = batchSchema.safeParse(await res.json())
    if (!parsed.success) throw new Error('Address locator returned an unexpected shape')

    for (const raw of parsed.data.locations ?? []) {
      const loc = locationSchema.safeParse(raw)
      if (!loc.success) continue
      const { location, score, attributes, address } = loc.data
      if (!location || (score ?? 0) < MIN_MATCH_SCORE) continue
      const id = Number(attributes?.ResultID)
      if (!Number.isFinite(id)) continue
      out.set(id, {
        // outSR=4326 means x is longitude and y is latitude. Swapping these is
        // the classic silent bug: every distance comes out plausible and wrong.
        longitude: location.x,
        latitude: location.y,
        score: score ?? 0,
        matchedAddress: address ?? '',
      })
    }
    return out
  }

  /**
   * Geocodes many addresses, in batches, tolerating a failed batch rather than
   * losing the whole run. Returns results keyed by the input string.
   */
  async geocodeAll(
    addresses: string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ results: Map<string, GeocodeResult>; failedBatches: number; totalBatches: number }> {
    const results = new Map<string, GeocodeResult>()
    const batches = chunk(addresses)
    let done = 0
    let failedBatches = 0
    for (const batch of batches) {
      try {
        const found = await this.geocodeBatch(batch)
        for (const [index, result] of found) {
          const key = batch[index]
          if (key !== undefined) results.set(key, result)
        }
      } catch {
        // One bad batch must not cost the rep the other nine hundred
        // addresses — but the count is returned rather than swallowed, because
        // *every* batch failing is a broken integration, not a blip, and it
        // must not look like "no addresses matched".
        failedBatches += 1
      }
      done += batch.length
      onProgress?.(done, addresses.length)
    }
    return { results, failedBatches, totalBatches: batches.length }
  }
}
