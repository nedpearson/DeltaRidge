import { describe, expect, it } from 'vitest'
import {
  classifyOwner,
  decideOccupancy,
  EbrParcelProvider,
  POISONED_FIELDS,
} from '@/integrations/parcel'

/** A parish response shaped exactly like the live one. */
function arcgisResponse(attributes: Record<string, unknown>, rings?: number[][][]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      features: [{ attributes, ...(rings ? { geometry: { rings } } : {}) }],
    }),
  } as unknown as Response
}

function captureUrl(res: Response): { fetchImpl: typeof fetch; urls: string[] } {
  const urls: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL) => {
    urls.push(String(input))
    return res
  }) as unknown as typeof fetch
  return { fetchImpl, urls }
}

const SANTA_MARIA = {
  ASSESSMENT_NUM: '009-8202-4',
  PRONO: 982024,
  OWNER: 'MANCUSO, WILLIAM DAVID',
  OWNER_ADDRESS: ' 18834 SANTA MARIA PKWY',
  OWNER_CITY_STATE_ZIP: 'BATON ROUGE, LA 70809',
  PHYSICAL_ADDRESS: '18834 SANTA MARIA PKWY',
  SUBDIVISION: 'SANTA MARIA',
  LOT: '141',
  BLOCK: null,
  LEGAL_DESCRIPTION: '2ND FILING. RESUB. 1995.',
  FLOOD_ZONE: 'AE / X PROTECTED BY LEVEE',
  STATUS: 'AC',
  SUM_HOMESTEAD_EXEMPTION: 7500,
  SUM_LAND_VALUE: 10000,
  SUM_ASSESSED_VALUE: 75050,
}

describe('the SALE_YEAR trap', () => {
  // Bisected against the live service on 2026-09-23: asking for SALE_YEAR
  // returns `features: []` with HTTP 200 and no error, for a query whose real
  // answer is 32 rows. `outFields=*` includes it, so it fails the same way.
  // This test is the guard rail; it asserts the request, because the response
  // is what the bug refuses to tell us.
  it('never asks the parish for a field that silently empties the result', async () => {
    const { fetchImpl, urls } = captureUrl(arcgisResponse(SANTA_MARIA))
    await new EbrParcelProvider(fetchImpl).search({ addressLike: 'SANTA MARIA' })

    const outFields = new URL(urls[0] ?? '').searchParams.get('outFields') ?? ''
    expect(outFields).not.toBe('*')
    for (const field of POISONED_FIELDS) {
      expect(outFields.split(',')).not.toContain(field)
    }
    expect(outFields.split(',')).toContain('OWNER')
  })
})

describe('classifyOwner', () => {
  it.each([
    ['MANCUSO, WILLIAM DAVID', 'person'],
    ['S & L THOMAS LIVING TRUST DATED FEBRUARY 27, 2023', 'trust'],
    ['SANTA MARIA PROPERTIES LLC', 'company'],
    ['CITY OF BATON ROUGE', 'government'],
  ])('reads %s as %s', (name, kind) => {
    expect(classifyOwner(name)).toBe(kind)
  })
})

describe('decideOccupancy', () => {
  it('trusts a homestead exemption over everything else', () => {
    // Claimed under oath on a primary residence. Outranks an address compare,
    // and must still say owner-occupied when the tax bill goes elsewhere.
    expect(
      decideOccupancy({
        homesteadExemption: 7500,
        ownerMailingAddress: 'PO BOX 1234',
        propertyAddress: '18834 SANTA MARIA PKWY',
      }),
    ).toEqual({ occupancy: 'owner_occupied', basis: 'homestead_exemption' })
  })

  it('falls back to comparing the tax-bill address', () => {
    expect(
      decideOccupancy({
        ownerMailingAddress: ' 18834 SANTA MARIA PKWY',
        propertyAddress: '18834 SANTA MARIA PKWY',
      }),
    ).toEqual({ occupancy: 'owner_occupied', basis: 'mailing_matches' })
  })

  it('says LIKELY absentee, never absentee, on a mismatch', () => {
    // A PO box is not a tenant. The word "likely" is the whole point.
    const result = decideOccupancy({
      ownerMailingAddress: '900 MAIN ST',
      propertyAddress: '18834 SANTA MARIA PKWY',
    })
    expect(result).toEqual({ occupancy: 'likely_absentee', basis: 'mailing_differs' })
  })

  it('is unknown when the roll says nothing either way', () => {
    expect(decideOccupancy({})).toEqual({ occupancy: 'unknown', basis: 'unknown' })
  })
})

describe('EbrParcelProvider.search', () => {
  it('maps a real parish record', async () => {
    const { fetchImpl } = captureUrl(arcgisResponse(SANTA_MARIA))
    const [record] = await new EbrParcelProvider(fetchImpl).search({ addressLike: 'SANTA MARIA' })

    expect(record?.parcelNumber).toBe('009-8202-4')
    expect(record?.ownerName).toBe('MANCUSO, WILLIAM DAVID')
    expect(record?.ownerKind).toBe('person')
    expect(record?.occupancy).toBe('owner_occupied')
    expect(record?.occupancyBasis).toBe('homestead_exemption')
    expect(record?.assessedValue).toBe(75050)
    expect(record?.addressKey).toBe('18834 santa maria pkwy')
  })

  it('exposes no improvement or fair-market value', async () => {
    // Both columns exist in the parish schema and are empty on 100% of the
    // 2,000 parcels sampled. Surfacing them would put a zero on screen and a
    // rep would read it as a fact.
    const { fetchImpl } = captureUrl(arcgisResponse(SANTA_MARIA))
    const [record] = await new EbrParcelProvider(fetchImpl).search({ addressLike: 'X' })
    expect(record).not.toHaveProperty('improvementValue')
    expect(record).not.toHaveProperty('fairMarketValue')
  })

  it('derives a parcel centroid from the boundary rather than geocoding', async () => {
    const ring = [
      [-91.006, 30.3435],
      [-91.005, 30.3435],
      [-91.005, 30.3445],
      [-91.006, 30.3445],
    ]
    const { fetchImpl } = captureUrl(arcgisResponse(SANTA_MARIA, [ring]))
    const [record] = await new EbrParcelProvider(fetchImpl).search({
      addressLike: 'SANTA MARIA',
      includeGeometry: true,
    })

    expect(record?.longitude).toBeCloseTo(-91.0055, 4)
    expect(record?.latitude).toBeCloseTo(30.344, 4)
    expect(record?.boundary).toHaveLength(4)
  })

  it('drops a parcel with no owner rather than showing a blank door', async () => {
    const { fetchImpl } = captureUrl(arcgisResponse({ ...SANTA_MARIA, OWNER: '   ' }))
    const records = await new EbrParcelProvider(fetchImpl).search({ addressLike: 'X' })
    expect(records).toHaveLength(0)
  })

  it('escapes a quote in an address instead of breaking the query', async () => {
    const { fetchImpl, urls } = captureUrl(arcgisResponse(SANTA_MARIA))
    await new EbrParcelProvider(fetchImpl).search({ addressLike: "O'NEAL" })
    expect(new URL(urls[0] ?? '').searchParams.get('where')).toContain("O''NEAL")
  })
})
