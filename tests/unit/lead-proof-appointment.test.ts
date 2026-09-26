import { describe, expect, it } from 'vitest'
import { proofForLead } from '@/features/leads/lead-proof'
import { appointmentBriefFor } from '@/features/leads/appointment-brief'
import type { ScoredLead } from '@/features/leads/scoring'
import type { ManagedLead } from '@/features/leads/pipeline'

const scored = {
  addressKey: '123-main',
  address: '123 Main St',
  latitude: 30.45,
  longitude: -91.15,
  roofPermit: {
    externalId: 'p1',
    provider: 'ebr',
    address: '123 Main St',
    addressKey: '123-main',
    kind: 'new_build',
    issuedAt: '2012-01-01',
  },
  parcel: {
    externalId: 'parcel-1',
    provider: 'ebr',
    parcelNumber: '123',
    address: '123 Main St',
    addressKey: '123-main',
    parish: 'East Baton Rouge',
    ownerName: 'JANE SMITH',
    ownerKind: 'person',
    ownerConfidence: 'high',
    occupancy: 'owner_occupied',
    occupancyBasis: 'homestead_exemption',
    assessedValue: 45000,
    latitude: 30.45,
    longitude: -91.15,
    retrievedAt: '2026-09-20T00:00:00Z',
  },
  score: 78,
  breakdown: [],
  components: {
    hailSizeInches: 1.5,
    daysSinceStorm: 100,
    distanceMiles: 0.8,
    roofAgeYears: 14,
  },
  storm: {
    externalId: 'storm-1',
    provider: 'noaa',
    eventType: 'hail',
    observation: 'official_report',
    latitude: 30.455,
    longitude: -91.15,
    occurredAt: '2026-05-08T20:00:00Z',
    hailSizeInches: 1.5,
  },
  reasons: ['old roof', 'hail nearby'],
} as unknown as ScoredLead

const managed = {
  id: 'lead-1',
  addressKey: '123-main',
  address: '123 Main St',
  latitude: 30.45,
  longitude: -91.15,
  score: 78,
  reasons: ['old roof', 'hail nearby'],
  status: 'appointment',
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z',
  contactName: 'Jane Smith',
  contactPhone: '2255550100',
  contactSource: 'homeowner_at_door',
  appointmentAt: '2026-09-27T15:00:00Z',
  knockCount: 1,
  consent: {
    call: { at: '2026-09-20T00:00:00Z', source: 'verbal_at_door' },
  },
} satisfies ManagedLead

describe('lead proof', () => {
  it('keeps nearby storm evidence limited to what the source proves', () => {
    const proof = proofForLead(scored, managed)
    const storm = proof.items.find((item) => item.key === 'storm')
    expect(storm?.source).toContain('NWS')
    expect(storm?.limitation).toContain('not a measurement on this roof')
  })

  it('treats homeowner-provided callable contact as established', () => {
    const proof = proofForLead(scored, managed)
    expect(proof.items.find((item) => item.key === 'phone')?.state).toBe('established')
  })
})

describe('appointment brief', () => {
  it('uses evidence and explicit verification tasks rather than sales probability claims', () => {
    const brief = appointmentBriefFor(managed, scored)
    expect(brief.title).toBe('Appointment prep brief')
    expect(brief.facts.join(' ')).toContain('Property opportunity 78/100')
    expect(brief.verify.join(' ')).toContain('current roof condition')
    expect(brief.proof.join(' ')).toContain('Roof-age source')
  })
})
