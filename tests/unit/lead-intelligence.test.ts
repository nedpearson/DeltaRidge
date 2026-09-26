import { describe, expect, it } from 'vitest'
import { contactabilityIndex, intelligenceFor, intentIndex } from '@/features/leads/lead-intelligence'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'

function managed(over: Partial<ManagedLead> = {}): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '123-main',
    address: '123 Main St',
    latitude: 30.45,
    longitude: -91.18,
    score: 75,
    reasons: [],
    status: 'new',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    knockCount: 0,
    ...over,
  }
}

const scored = {
  addressKey: '123-main',
  address: '123 Main St',
  latitude: 30.45,
  longitude: -91.18,
  roofPermit: {
    externalId: 'permit-1',
    provider: 'ebr',
    kind: 'new_build',
    permitType: 'residential',
    issuedAt: '2010-01-01T00:00:00Z',
    address: '123 Main St',
    addressKey: '123-main',
  },
  score: 82,
  breakdown: [],
  components: { hailSizeInches: 1.75, daysSinceStorm: 60, distanceMiles: 0.7, roofAgeYears: 16 },
  storm: {
    externalId: 'storm-1',
    provider: 'noaa',
    eventType: 'hail',
    occurredAt: '2026-05-01T00:00:00Z',
    hailSizeInches: 1.75,
    latitude: 30.45,
    longitude: -91.18,
  },
  reasons: [],
} satisfies ScoredLead

describe('lead intelligence', () => {
  it('keeps intent separate from property opportunity', () => {
    expect(intentIndex(managed({ status: 'new' }))).toBe(5)
    expect(intentIndex(managed({ status: 'appointment' }))).toBe(90)
  })

  it('does not call a lookup phone highly contactable without homeowner source and permission', () => {
    const lead = managed({
      contactPhone: '2255550101',
      contactSource: 'third_party_lookup',
    })
    expect(contactabilityIndex(lead)).toBeLessThan(60)
  })

  it('rewards homeowner-provided, permitted contact without treating it as a sale probability', () => {
    const lead = managed({
      contactName: 'Jane Smith',
      contactPhone: '2255550101',
      contactSource: 'homeowner_at_door',
      consent: {
        call: { at: '2026-09-20T12:00:00Z', source: 'verbal_at_door' },
        sms: { at: '2026-09-20T12:00:00Z', source: 'verbal_at_door' },
      },
      status: 'appointment',
    })
    expect(contactabilityIndex(lead)).toBeGreaterThanOrEqual(80)
    expect(intelligenceFor(scored, lead).level).toBe('ultimate')
  })

  it('makes opt-out terminal for contactability and intent', () => {
    const lead = managed({
      contactPhone: '2255550101',
      contactSource: 'homeowner_at_door',
      optedOutAt: '2026-09-22T12:00:00Z',
    })
    expect(contactabilityIndex(lead)).toBe(0)
    expect(intentIndex(lead)).toBe(0)
  })
})
