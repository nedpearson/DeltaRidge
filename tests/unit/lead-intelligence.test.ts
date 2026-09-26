import { describe, expect, it } from 'vitest'
import { evaluateLeadIntelligence } from '@/features/leads/intelligence'
import type { ScoredLead } from '@/features/leads/scoring'
import type { ManagedLead } from '@/features/leads/pipeline'

function scored(over: Partial<ScoredLead> = {}): ScoredLead {
  return {
    addressKey: '123-main-70810',
    address: '123 Main St',
    latitude: 30.4,
    longitude: -91.1,
    roofPermit: {
      externalId: 'permit-1',
      provider: 'ebr',
      kind: 'reroof',
      permitType: 'REROOF',
      issuedAt: '2010-01-01',
      address: '123 Main St',
      addressKey: '123-main-70810',
    },
    score: 82,
    breakdown: [],
    components: {
      hailSizeInches: 1.75,
      daysSinceStorm: 90,
      distanceMiles: 0.8,
      roofAgeYears: 16,
    },
    storm: {
      externalId: 'storm-1',
      provider: 'noaa',
      eventType: 'hail',
      latitude: 30.4,
      longitude: -91.1,
      occurredAt: '2026-06-01T12:00:00Z',
      hailSizeInches: 1.75,
      observation: 'official_report',
    },
    reasons: ['strong storm evidence'],
    ...over,
  }
}

function managed(status: ManagedLead['status'] = 'new'): ManagedLead {
  return {
    id: 'lead-1',
    addressKey: '123-main-70810',
    address: '123 Main St',
    latitude: 30.4,
    longitude: -91.1,
    score: 82,
    reasons: ['strong storm evidence'],
    status,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    knockCount: 0,
  }
}

describe('lead intelligence', () => {
  it('keeps property, intent and contactability independent', () => {
    const result = evaluateLeadIntelligence({
      scored: scored(),
      managed: managed('new'),
      hasCurrentImagery: true,
      imageryAgeDays: 30,
      hasRoofMeasurement: true,
      ownerIdentified: true,
      ownerOccupied: true,
      phonePresent: true,
      emailPresent: true,
      contactConfirmed: true,
      contactSource: 'homeowner',
      optedOut: false,
    })

    expect(result.propertyScore).toBeGreaterThan(70)
    expect(result.intentScore).toBe(0)
    expect(result.contactabilityScore).toBeGreaterThan(70)
    expect(result.certification).not.toBe('ultimate')
  })

  it('earns ultimate only with strong property, contactability and observed intent', () => {
    const result = evaluateLeadIntelligence({
      scored: scored({ score: 90 }),
      managed: managed('appointment'),
      hasCurrentImagery: true,
      imageryAgeDays: 45,
      hasRoofMeasurement: true,
      ownerIdentified: true,
      ownerOccupied: true,
      phonePresent: true,
      emailPresent: true,
      contactConfirmed: true,
      contactSource: 'homeowner',
      optedOut: false,
      appointmentConfirmed: true,
    })

    expect(result.certification).toBe('ultimate')
    expect(result.intentScore).toBeGreaterThanOrEqual(90)
  })

  it('blocks ultimate status after an opt-out', () => {
    const result = evaluateLeadIntelligence({
      scored: scored({ score: 95 }),
      managed: managed('appointment'),
      hasCurrentImagery: true,
      imageryAgeDays: 10,
      hasRoofMeasurement: true,
      ownerIdentified: true,
      ownerOccupied: true,
      phonePresent: true,
      emailPresent: true,
      contactConfirmed: true,
      contactSource: 'homeowner',
      optedOut: true,
      appointmentConfirmed: true,
    })

    expect(result.contactabilityScore).toBe(0)
    expect(result.certification).toBe('insufficient')
  })

  it('does not treat provider data as homeowner intent', () => {
    const result = evaluateLeadIntelligence({
      scored: scored(),
      managed: managed('new'),
      hasCurrentImagery: false,
      hasRoofMeasurement: false,
      ownerIdentified: true,
      ownerOccupied: true,
      phonePresent: true,
      emailPresent: false,
      contactConfirmed: false,
      contactSource: 'third_party_lookup',
      optedOut: false,
    })

    expect(result.intentScore).toBe(0)
    expect(result.contactabilityScore).toBeLessThan(50)
    expect(result.missingRequirements).toContain('confirmed contact identity')
  })
})
