import { describe, expect, it } from 'vitest'
import { buildPropertyProfile } from '@/features/leads/property-profile'
import type { ParcelRecord } from '@/integrations/parcel'
import type { PermitRecord } from '@/integrations/permits/types'

const NOW = new Date('2026-09-23T12:00:00.000Z')

function parcel(over: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    externalId: 'ebr:009-8202-4',
    provider: 'ebr',
    parcelNumber: '009-8202-4',
    address: '18834 SANTA MARIA PKWY',
    addressKey: '18834 santa maria pkwy',
    parish: 'East Baton Rouge',
    ownerName: 'MANCUSO, WILLIAM DAVID',
    ownerKind: 'person',
    ownerConfidence: 'high',
    ownerMailingAddress: ' 18834 SANTA MARIA PKWY',
    ownerMailingCityStateZip: 'BATON ROUGE, LA 70809',
    occupancy: 'owner_occupied',
    occupancyBasis: 'homestead_exemption',
    homesteadExemption: 7500,
    subdivision: 'SANTA MARIA',
    floodZone: 'X PROTECTED BY LEVEE',
    assessedValue: 75050,
    landValue: 10000,
    retrievedAt: '2026-09-23T11:00:00.000Z',
    ...over,
  }
}

function permit(over: Partial<PermitRecord> = {}): PermitRecord {
  return {
    externalId: 'p1',
    provider: 'ebr',
    kind: 'new_build',
    permitType: 'New Building Permit (R)',
    issuedAt: '2013-01-25T00:00:00.000',
    address: '18834 SANTA MARIA PKWY',
    addressKey: '18834 santa maria pkwy',
    ...over,
  }
}

function build(over: Parameters<typeof buildPropertyProfile>[0] extends infer T ? Partial<T> : never = {}) {
  return buildPropertyProfile({
    address: '18834 SANTA MARIA PKWY',
    addressKey: '18834 santa maria pkwy',
    parcel: parcel(),
    permits: [permit()],
    storms: [],
    now: NOW,
    ...over,
  })
}

describe('owner', () => {
  it('states the recorded owner as verified, from the assessor', () => {
    const p = build()
    expect(p.owner.name.value).toBe('MANCUSO, WILLIAM DAVID')
    expect(p.owner.name.certainty).toBe('verified')
    expect(p.owner.name.source.label).toBe('East Baton Rouge Assessor')
  })

  it('joins the mailing address the parish splits across two columns', () => {
    expect(build().owner.mailingAddress.value).toBe('18834 SANTA MARIA PKWY, BATON ROUGE, LA 70809')
  })

  it('calls a homestead exemption verified and an address match only estimated', () => {
    // The exemption is a filing the owner made. The address comparison is our
    // own inference, and must never be dressed as a record.
    expect(build().owner.occupancy.certainty).toBe('verified')

    const inferred = build({
      parcel: parcel({ occupancyBasis: 'mailing_matches', homesteadExemption: undefined }),
    })
    expect(inferred.owner.occupancy.certainty).toBe('estimated')
    expect(inferred.owner.occupancy.basis).toContain('tax bill')
  })

  it('has no owner to show when no parcel matched, and says why', () => {
    const p = build({ parcel: undefined })
    expect(p.owner.name.value).toBeNull()
    expect(p.owner.name.basis).toContain('no recorded owner')
  })
})

describe('roof', () => {
  it('ages the roof from the build permit when there is no re-roof', () => {
    const p = build()
    expect(p.roof.yearBuilt.value).toBe(2013)
    expect(p.roof.ageYears.value).toBe(13)
    // Always an estimate. A permit authorises work; it does not prove work.
    expect(p.roof.ageYears.certainty).toBe('estimated')
    expect(p.roof.ageYears.basis).toContain('no re-roof permit on file')
  })

  it('ages from the re-roof once there is one, and names the contractor', () => {
    const p = build({
      permits: [
        permit(),
        permit({
          externalId: 'p2',
          kind: 'reroof',
          permitType: 'Re-Roof (R)',
          issuedAt: '2021-06-01T00:00:00.000',
          contractorName: 'GULF COAST ROOFING LLC',
        }),
      ],
    })
    expect(p.roof.ageYears.value).toBe(5)
    expect(p.roof.lastReroofAt.value).toBe('2021-06-01T00:00:00.000')
    expect(p.roof.lastContractor.value).toBe('GULF COAST ROOFING LLC')
  })

  it('refuses to invent a roof age with no permit at all', () => {
    const p = build({ permits: [] })
    expect(p.roof.ageYears.value).toBeNull()
    expect(p.roof.ageYears.basis).toContain('no basis')
  })

  it('distinguishes "none on file" from "we cannot see this"', () => {
    // "No re-roof permit on file" is a selling point and must read as a
    // finding. It is not the same as a field the app cannot source at all.
    const p = build()
    expect(p.roof.lastReroofAt.value).toBeNull()
    expect(p.roof.lastReroofAt.basis).toContain('No re-roof permit is on file')
    expect(p.unavailable.map((u) => u.field)).toContain('roofMaterial')
  })
})

describe('what the free sources cannot do', () => {
  it('names every missing field and why, rather than showing dashes', () => {
    const fields = build().unavailable
    expect(fields.map((f) => f.field)).toEqual(
      expect.arrayContaining(['beds', 'baths', 'livingArea', 'saleHistory', 'marketValue']),
    )
    for (const f of fields) expect(f.reason.length).toBeGreaterThan(10)
  })

  it('never exposes the parish market-value column, which is empty on every parcel', () => {
    const p = build()
    expect(p).not.toHaveProperty('marketValue')
    expect(p.unavailable.find((f) => f.field === 'marketValue')?.reason).toContain('empty')
  })
})
