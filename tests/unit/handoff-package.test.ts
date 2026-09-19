import { describe, expect, it } from 'vitest'
import {
  buildHandoffPackage,
  packageFingerprint,
  stableStringify,
  type HandoffInput,
} from '@/features/handoff/package'
import type { LocalInspection, LocalObservation, LocalPhoto, LocalVoiceNote } from '@/lib/db'

function inspection(overrides: Partial<LocalInspection> = {}): LocalInspection {
  return {
    id: 'insp-1',
    createdAt: '2026-09-18T14:00:00.000Z',
    updatedAt: '2026-09-18T15:00:00.000Z',
    status: 'complete',
    completedAt: '2026-09-18T15:00:00.000Z',
    customerFirstName: 'Dale',
    customerLastName: 'Guidry',
    customerPhone: '(225) 555-0142',
    addressLine1: '1655 Cottondale Dr',
    city: 'Baton Rouge',
    parish: 'East Baton Rouge',
    postalCode: '70816',
    propertyType: 'residential',
    stories: 1,
    roofMaterial: 'asphalt_shingle',
    homeownerStatedRoofAgeYears: 14,
    homeownerStatedInsurer: 'State Farm',
    inspectorRecommendation: 'Full replacement.',
    syncState: 'local',
    ...overrides,
  }
}

function photo(id: string, overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    id,
    inspectionId: 'insp-1',
    category: 'roof_overview',
    blob: new Blob(['x']),
    thumbnail: new Blob(['t']),
    width: 1600,
    height: 1200,
    byteSize: 900,
    capturedAt: '2026-09-18T14:10:00.000Z',
    retakeRecommended: false,
    syncState: 'local',
    ...overrides,
  }
}

function observation(id: string, overrides: Partial<LocalObservation> = {}): LocalObservation {
  return {
    id,
    inspectionId: 'insp-1',
    finding: 'Possible hail impacts, rear slope',
    severity: 'requires_verification',
    source: 'inspector',
    createdAt: '2026-09-18T14:20:00.000Z',
    syncState: 'local',
    ...overrides,
  }
}

function voiceNote(id: string, overrides: Partial<LocalVoiceNote> = {}): LocalVoiceNote {
  return {
    id,
    inspectionId: 'insp-1',
    blob: new Blob(['a']),
    durationSeconds: 42,
    recordedAt: '2026-09-18T14:30:00.000Z',
    syncState: 'local',
    ...overrides,
  }
}

function input(overrides: Partial<HandoffInput> = {}): HandoffInput {
  return {
    inspection: inspection(),
    photos: [photo('p1')],
    observations: [observation('o1')],
    voiceNotes: [voiceNote('v1')],
    requiredCategories: ['roof_overview'],
    generatedAt: '2026-09-18T15:05:00.000Z',
    ...overrides,
  }
}

describe('buildHandoffPackage', () => {
  it('carries the customer, property and recommendation the office needs', () => {
    const { payload } = buildHandoffPackage(input())
    expect(payload.customer.name).toBe('Dale Guidry')
    expect(payload.customer.phone).toBe('(225) 555-0142')
    expect(payload.property.addressLine1).toBe('1655 Cottondale Dr')
    expect(payload.property.parish).toBe('East Baton Rouge')
    expect(payload.inspection.inspectorRecommendation).toBe('Full replacement.')
  })

  it('keeps homeowner statements in their own namespace, never as findings', () => {
    const { payload } = buildHandoffPackage(input())
    expect(payload.homeownerStated.roofAgeYears).toBe(14)
    expect(payload.homeownerStated.insurer).toBe('State Farm')
    // The only place roof age appears is under homeownerStated.
    const flat = JSON.stringify(payload.observations)
    expect(flat).not.toContain('14')
  })

  it('preserves observation provenance and confirmation state', () => {
    const { payload } = buildHandoffPackage(
      input({
        observations: [
          observation('o1', { source: 'ai' }),
          observation('o2', { source: 'inspector', confirmedAt: '2026-09-18T14:25:00.000Z' }),
        ],
      }),
    )
    const [ai, human] = payload.observations
    expect(ai?.source).toBe('ai')
    expect(ai?.confirmedByRep).toBe(false)
    expect(human?.source).toBe('inspector')
    expect(human?.confirmedByRep).toBe(true)
  })

  it('separates usable photos from ones flagged for retake', () => {
    const { payload } = buildHandoffPackage(
      input({
        photos: [photo('p1'), photo('p2', { retakeRecommended: true, qualityFlag: 'blurry' })],
      }),
    )
    expect(payload.photoSummary.usable).toBe(1)
    expect(payload.photoSummary.flaggedForRetake).toBe(1)
    // Both are still in the package — the office decides, the app does not hide.
    expect(payload.photos).toHaveLength(2)
  })

  it('records what was missing and what the rep waived', () => {
    const { payload } = buildHandoffPackage(
      input({
        inspection: inspection({
          overriddenIssueCodes: ['missing-front-elevation'],
          overrideNote: 'Homeowner would not let me on the roof.',
        }),
        photos: [],
      }),
    )
    expect(payload.validation.overriddenIssueCodes).toEqual(['missing-front-elevation'])
    expect(payload.validation.overrideNote).toBe('Homeowner would not let me on the roof.')
    expect(payload.validation.blockers.length).toBeGreaterThan(0)
  })

  it('keeps the voice transcript slot even when nothing has transcribed it yet', () => {
    const { payload } = buildHandoffPackage(input())
    expect(payload.voiceNotes).toHaveLength(1)
    expect(payload.voiceNotes[0]?.transcript).toBeNull()
    expect(payload.voiceNotes[0]?.durationSeconds).toBe(42)
  })

  it('orders photos, observations and voice notes by capture time', () => {
    const { payload } = buildHandoffPackage(
      input({
        photos: [
          photo('late', { capturedAt: '2026-09-18T14:50:00.000Z' }),
          photo('early', { capturedAt: '2026-09-18T14:05:00.000Z' }),
        ],
      }),
    )
    expect(payload.photos.map((p) => p.clientId)).toEqual(['early', 'late'])
  })
})

describe('stableStringify', () => {
  it('produces identical text for structurally identical objects', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('preserves array order, which is meaningful', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('drops undefined values rather than emitting invalid JSON', () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{"b":1}')
  })
})

describe('packageFingerprint', () => {
  it('is stable across rebuilds of the same inspection', () => {
    const a = buildHandoffPackage(input()).payload
    const b = buildHandoffPackage(input()).payload
    expect(packageFingerprint(a)).toBe(packageFingerprint(b))
  })

  it('ignores generatedAt, so a resend of unchanged work is a no-op', () => {
    const a = buildHandoffPackage(input({ generatedAt: '2026-09-18T15:05:00.000Z' })).payload
    const b = buildHandoffPackage(input({ generatedAt: '2026-09-19T09:00:00.000Z' })).payload
    expect(a.generatedAt).not.toBe(b.generatedAt)
    expect(packageFingerprint(a)).toBe(packageFingerprint(b))
  })

  it('changes when the rep actually changes something', () => {
    const before = buildHandoffPackage(input()).payload
    const after = buildHandoffPackage(
      input({ inspection: inspection({ inspectorRecommendation: 'Repair only.' }) }),
    ).payload
    expect(packageFingerprint(before)).not.toBe(packageFingerprint(after))
  })

  it('changes when a photo is added', () => {
    const before = buildHandoffPackage(input()).payload
    const after = buildHandoffPackage(input({ photos: [photo('p1'), photo('p2')] })).payload
    expect(packageFingerprint(before)).not.toBe(packageFingerprint(after))
  })
})
