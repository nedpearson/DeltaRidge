import { describe, expect, it } from 'vitest'
import { PARISHES, STATEWIDE, femaFloodMapUrl, findParish } from './parish-resources'

describe('findParish', () => {
  it('matches the parish on file, however it is written', () => {
    expect(findParish('East Baton Rouge Parish')?.resources.parish).toBe('East Baton Rouge')
    expect(findParish('EBR')?.resources.parish).toBe('East Baton Rouge')
    expect(findParish('st. helena')?.resources.parish).toBe('St. Helena')
    expect(findParish('Ascension')?.inferred).toBe(false)
  })

  it('falls back to the city and says it inferred it', () => {
    const r = findParish(null, 'Prairieville')
    expect(r?.resources.parish).toBe('Ascension')
    expect(r?.inferred).toBe(true)
  })

  it('returns null rather than guessing for an unknown place', () => {
    expect(findParish('Orleans', 'New Orleans')).toBeNull()
  })
})

describe('resource data', () => {
  it('uses https for every link except the one parish that only serves http', () => {
    const urls = [...PARISHES.flatMap((p) => [p.assessor, p.permits.url, p.gis]), ...STATEWIDE.map((s) => s.url)].filter(Boolean) as string[]
    const insecure = urls.filter((u) => !u.startsWith('https://'))
    expect(insecure).toEqual(['http://www.efsedge.com/Iberville'])
  })

  it('never links the known look-alike domains', () => {
    const all = JSON.stringify({ PARISHES, STATEWIDE })
    expect(all).not.toContain('sthelenaparish.org')
    expect(all).not.toContain('pcpolicejury.org')
  })

  it('builds a FEMA address query', () => {
    expect(femaFloodMapUrl('1 Oak St, Baton Rouge, LA')).toBe('https://msc.fema.gov/portal/search?AddressQuery=1%20Oak%20St%2C%20Baton%20Rouge%2C%20LA')
  })
})
