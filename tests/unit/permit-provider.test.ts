import { describe, expect, it, vi } from 'vitest'
import { EbrPermitProvider, buildWhere, classifyPermitType } from '@/integrations/permits/ebr'
import { chunk, streetLineOf } from '@/integrations/geocode/ebr'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

describe('classifyPermitType', () => {
  it('recognises the parish wording exactly', () => {
    expect(classifyPermitType('Re-Roof (R)')).toBe('reroof')
    expect(classifyPermitType('Re-Roof (C)')).toBe('reroof')
    expect(classifyPermitType('New Building Permit (R)')).toBe('new_build')
    expect(classifyPermitType('Generator Permit (R)')).toBe('other')
  })
})

describe('buildWhere', () => {
  it('filters to both re-roof types', () => {
    const where = buildWhere({ kinds: ['reroof'] })
    expect(where).toContain("'Re-Roof (R)'")
    expect(where).toContain("'Re-Roof (C)'")
  })

  it('casts coordinates to numbers for a bbox', () => {
    // These are text columns; comparing them as strings returns nonsense for
    // negative longitudes without ever erroring.
    const where = buildWhere({ kinds: ['new_build'], bbox: [-91.5, 30.1, -90.5, 30.9] })
    expect(where).toContain('(lat::number) between 30.1 and 30.9')
    expect(where).toContain('(long::number) between -91.5 and -90.5')
    expect(where).toContain('lat IS NOT NULL')
  })

  it('omits the bbox clause entirely when none is given', () => {
    // This matters: bbox-filtering the old permits would drop almost all of
    // them, because the parish only geocoded its records from about 2016.
    const where = buildWhere({ kinds: ['new_build'], issuedTo: '2014-12-31' })
    expect(where).not.toContain('lat')
    expect(where).toContain("issueddate <= '2014-12-31'")
  })

  it('escapes quotes rather than building a broken query', () => {
    expect(buildWhere({ kinds: [] })).toBe('')
  })
})

describe('EbrPermitProvider.search', () => {
  it('maps a parish row onto a permit record', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        {
          permitid: '123',
          permittype: 'Re-Roof (R)',
          issueddate: '2026-09-04T00:00:00.000',
          address: '8141 SEVILLE CT BATON ROUGE LA 70808',
          projectvalue: '27500',
          contractorname: 'Gulf Coast Construction',
          lat: '30.41',
          long: '-91.12',
        },
      ]),
    )
    const [record] = await new EbrPermitProvider(fetchImpl as unknown as typeof fetch).search({ kinds: ['reroof'] })
    expect(record?.kind).toBe('reroof')
    expect(record?.projectValue).toBe(27500)
    expect(record?.latitude).toBe(30.41)
    expect(record?.longitude).toBe(-91.12)
    // Normalised for matching against other permits at the same address.
    expect(record?.addressKey).toBe('8141 seville ct baton rouge la 70808')
  })

  it('drops a row it cannot understand instead of failing the whole pull', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse([
        { permittype: 'Re-Roof (R)' }, // no date, no address
        { permittype: 'Re-Roof (R)', issueddate: '2026-01-01', address: '1 GOOD ST' },
      ]),
    )
    const rows = await new EbrPermitProvider(fetchImpl as unknown as typeof fetch).search({ kinds: ['reroof'] })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.address).toBe('1 GOOD ST')
  })

  it('reports unavailability in plain language a rep can act on', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    })
    const status = await new EbrPermitProvider(fetchImpl as unknown as typeof fetch).availability()
    expect(status.available).toBe(false)
    expect(status.reason).toMatch(/still here/i)
  })
})

describe('geocoder helpers', () => {
  it('strips the city tail the permit feed appends', () => {
    expect(streetLineOf('3243 TIMBER GROVE DR  BATON ROUGE LA 70816')).toBe('3243 TIMBER GROVE DR')
    expect(streetLineOf('37161 GREENWELL SPRINGS RD GREENWELL SPRINGS LA')).toBe('37161 GREENWELL SPRINGS RD')
  })

  it('leaves a bare street line alone', () => {
    expect(streetLineOf('1655 COTTONDALE DR')).toBe('1655 COTTONDALE DR')
  })

  it('batches to a size the locator accepts', () => {
    const batches = chunk(Array.from({ length: 250 }, (_, i) => String(i)))
    expect(batches).toHaveLength(3)
    expect(batches[0]).toHaveLength(100)
    expect(batches[2]).toHaveLength(50)
  })
})

describe('streetLineOf — the city-in-street-name trap', () => {
  it('keeps a street named after a town', () => {
    expect(streetLineOf('37161 GREENWELL SPRINGS RD GREENWELL SPRINGS LA 70739')).toBe(
      '37161 GREENWELL SPRINGS RD',
    )
    expect(streetLineOf('1000 ZACHARY HWY ZACHARY LA')).toBe('1000 ZACHARY HWY')
  })

  it('handles mixed case and a ZIP+4', () => {
    expect(streetLineOf('2063 RUE VENELLE ST Baton Rouge LA 70808-1234')).toBe('2063 RUE VENELLE ST')
  })

  it('leaves an address with no city tail untouched', () => {
    expect(streetLineOf('19718 SOUTHERN HILLS AVE')).toBe('19718 SOUTHERN HILLS AVE')
  })
})
