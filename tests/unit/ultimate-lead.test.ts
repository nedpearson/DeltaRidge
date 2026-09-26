import { describe, expect, it } from 'vitest'
import { assessUltimateLead } from '@/features/leads/ultimate-lead'
import type { ManagedLead } from '@/features/leads/pipeline'
import type { ScoredLead } from '@/features/leads/scoring'

const scored = {
  addressKey: '123-main',
  address: '123 Main St',
  latitude: 30.45,
  longitude: -91.18,
  roofPermit: {
    externalId: 'permit-1',
    kind: 'new_build',
    issuedAt: '2008-01-01',
    address: '123 Main St',
    addressKey: '123-main',
    contractorName: null,
  },
  score: 82,
  breakdown: [],
  components: {
    hailSizeInches: 1.75,
    daysSinceStorm: 90,
    distanceMiles: 0.8,
    roofAgeYears: 18,
  },
  storm: {
    provider: 'nws',
    externalId: 'storm-1',
    eventType: 'hail',
    occurredAt: '2026-05-01T00:00:00.000Z',
    latitude: 30.45,
    longitude: -91.18,
    hailSizeInches: 1.75,
    observation: 'official_report',
  },
  reasons: ['1.75" hail reported nearby', 'Roof is about 18 years old'],
} as unknown as ScoredLead

function managed(overrides: Partial<ManagedLead> = {}): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '123-main',
    address: '123 Main St',
    latitude: 30.45,
    longitude: -91.18,
    score: 82,
    reasons: scored.reasons,
    status: 'appointment',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    contactPhone: '2255550101',
    contactSource: 'homeowner_at_door',
    consent: {
      call: { at: '2026-09-01T00:00:00.000Z', source: 'verbal_at_door' },
      sms: { at: '2026-09-01T00:00:00.000Z', source: 'verbal_at_door' },
    },
    knockCount: 1,
    ...overrides,
  }
}

describe('ultimate lead assessment', () => {
  it('keeps property, intent and contactability as separate explainable signals', () => {
    const result = assessUltimateLead({ scored, managed: managed() })
    expect(result.propertyOpportunity.score).toBe(82)
    expect(result.homeownerIntent.score).toBe(90)
    expect(result.contactability.score).toBeGreaterThanOrEqual(70)
    expect(result.tier).toBe('ultimate')
  })

  it('does not turn a strong property into an ultimate lead without homeowner intent', () => {
    const result = assessUltimateLead({
      scored,
      managed: managed({ status: 'attempted', consent: undefined }),
    })
    expect(result.propertyOpportunity.score).toBe(82)
    expect(result.homeownerIntent.score).toBe(10)
    expect(result.tier).not.toBe('ultimate')
  })

  it('makes an opt-out a hard blocker regardless of property quality', () => {
    const result = assessUltimateLead({
      scored,
      managed: managed({ optedOutAt: '2026-09-02T00:00:00.000Z' }),
    })
    expect(result.tier).toBe('blocked')
    expect(result.contactability.score).toBe(0)
  })
})
