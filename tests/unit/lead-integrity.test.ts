import { describe, expect, it } from 'vitest'
import {
  IMAGERY_STALE_DAYS,
  integrityChecks,
  summarise,
  type IntegrityEvidence,
} from '@/features/leads/integrity'

/**
 * The point of these tests is not that the function returns strings. It is that
 * nothing reaches `established` without the artefact that earns it — the whole
 * value of the panel is that a green line is load-bearing.
 */

const NOW = '2026-09-23T12:00:00.000Z'

const nothing: IntegrityEvidence = {
  address: '18818 Bella Vista Ct',
  phoneSource: null,
  hasEmail: false,
  callConsentAt: null,
  smsConsentAt: null,
  callWindowRuleIds: ['la-dnc-calling-window'],
  optedOut: false,
  stormSource: null,
  stormEventAt: null,
  imageryCapturedAt: null,
  gpsVerifiedKnocks: 0,
  totalKnocks: 0,
  voiceNotes: 0,
  voiceNotesTranscribed: 0,
  roofrJobId: null,
  roofrLastEventAt: null,
  pendingSyncItems: 0,
  failedSyncItems: 0,
  now: NOW,
}

function find(evidence: IntegrityEvidence, key: string) {
  const check = integrityChecks(evidence).find((c) => c.key === key)
  if (check === undefined) throw new Error(`no check named ${key}`)
  return check
}

describe('nothing is established without evidence', () => {
  it('a brand new lead claims almost nothing', () => {
    const checks = integrityChecks(nothing)
    const established = checks.filter((c) => c.state === 'established').map((c) => c.key)
    // Only the two things that are actually true of an untouched lead: it has an
    // address, and there is nothing waiting to sync.
    expect(established.sort()).toEqual(['address', 'sync'])
  })

  it('every check names what earned its state', () => {
    for (const check of integrityChecks(nothing)) {
      expect(check.basis.trim()).not.toBe('')
    }
  })
})

describe('phone', () => {
  it('is established only when the homeowner gave it', () => {
    expect(find({ ...nothing, phoneSource: 'homeowner_at_door' }, 'phone').state).toBe('established')
    expect(find({ ...nothing, phoneSource: 'homeowner_by_phone' }, 'phone').state).toBe('established')
  })

  it('a looked-up number is reported, never established, and says it cannot be dialled', () => {
    const check = find({ ...nothing, phoneSource: 'third_party_lookup' }, 'phone')
    expect(check.state).toBe('reported')
    expect(check.basis).toContain('cannot be dialled')
  })

  it('a public-record number is not established either', () => {
    expect(find({ ...nothing, phoneSource: 'public_record' }, 'phone').state).toBe('reported')
    expect(find({ ...nothing, phoneSource: 'unknown' }, 'phone').state).toBe('reported')
  })
})

describe('permission', () => {
  it('an opt-out is attention, not a missing tick', () => {
    const check = find({ ...nothing, optedOut: true, callConsentAt: NOW }, 'permission')
    expect(check.state).toBe('attention')
    expect(check.basis).toContain('Do not contact')
  })

  it('an opt-out outranks consent recorded earlier', () => {
    // Consent then opt-out must not read as consent.
    expect(find({ ...nothing, optedOut: true, smsConsentAt: NOW }, 'permission').state).toBe('attention')
  })

  it('no rule having cleared the call is attention, not silence', () => {
    // Matches the engine, which refuses a call when nothing has cleared it.
    const check = find({ ...nothing, callWindowRuleIds: [] }, 'permission')
    expect(check.state).toBe('attention')
  })

  it('silence is absent, not refusal and not permission', () => {
    expect(find(nothing, 'permission').state).toBe('absent')
  })
})

describe('imagery', () => {
  it('is established when recently captured', () => {
    const check = find({ ...nothing, imageryCapturedAt: '2026-09-05T00:00:00Z' }, 'imagery')
    expect(check.state).toBe('established')
    expect(check.basis).toContain('18 days ago')
  })

  it('goes stale rather than staying green', () => {
    const old = new Date(Date.parse(NOW) - (IMAGERY_STALE_DAYS + 5) * 86_400_000).toISOString()
    expect(find({ ...nothing, imageryCapturedAt: old }, 'imagery').state).toBe('stale')
  })

  it('reports the capture date, not the day it was fetched', () => {
    // The distinction the whole check exists for: a picture fetched today can
    // have been taken before the storm.
    const check = find({ ...nothing, imageryCapturedAt: '2025-01-01T00:00:00Z' }, 'imagery')
    expect(check.state).toBe('stale')
    expect(check.basis).toContain('months ago')
  })

  it('an unreadable capture date is attention, not assumed fresh', () => {
    expect(find({ ...nothing, imageryCapturedAt: 'sometime' }, 'imagery').state).toBe('attention')
  })
})

describe('door activity', () => {
  it('is established only when GPS placed the rep there', () => {
    expect(find({ ...nothing, totalKnocks: 3, gpsVerifiedKnocks: 2 }, 'visits').state).toBe('established')
  })

  it('knocks with no GPS are reported, and the wording does not accuse anybody', () => {
    const check = find({ ...nothing, totalKnocks: 3, gpsVerifiedKnocks: 0 }, 'visits')
    expect(check.state).toBe('reported')
    expect(check.basis).not.toMatch(/fraud|false|lying|fake/i)
  })
})

describe('roofr', () => {
  it('is established only when Roofr sent back a job id', () => {
    expect(find(nothing, 'roofr').state).toBe('absent')
    expect(find({ ...nothing, roofrJobId: '88213' }, 'roofr').state).toBe('established')
  })
})

describe('sync', () => {
  it('distinguishes waiting from given up', () => {
    expect(find({ ...nothing, pendingSyncItems: 4 }, 'sync').state).toBe('reported')
    expect(find({ ...nothing, failedSyncItems: 1 }, 'sync').state).toBe('attention')
  })

  it('a failure outranks a queue', () => {
    expect(find({ ...nothing, pendingSyncItems: 9, failedSyncItems: 1 }, 'sync').state).toBe('attention')
  })
})

describe('summarise', () => {
  it('counts rather than scores', () => {
    const summary = summarise(integrityChecks(nothing))
    expect(summary.total).toBeGreaterThan(0)
    // No percentage anywhere: a weighted score would need invented weights and
    // would round the one fact that matters into a rounding error.
    expect(summary.sentence).not.toMatch(/%/)
    expect(Object.keys(summary)).not.toContain('score')
    expect(Object.keys(summary)).not.toContain('percent')
  })

  it('leads with what needs attention rather than burying it in a ratio', () => {
    const summary = summarise(integrityChecks({ ...nothing, optedOut: true }))
    expect(summary.sentence).toContain('attention')
    expect(summary.needsAttention).toBe(1)
  })

  it('one problem on an otherwise complete lead still leads', () => {
    const complete: IntegrityEvidence = {
      ...nothing,
      phoneSource: 'homeowner_at_door',
      hasEmail: true,
      callConsentAt: NOW,
      smsConsentAt: NOW,
      stormSource: 'NOAA',
      stormEventAt: '2026-09-01T00:00:00Z',
      imageryCapturedAt: '2026-09-05T00:00:00Z',
      totalKnocks: 2,
      gpsVerifiedKnocks: 2,
      voiceNotes: 1,
      voiceNotesTranscribed: 1,
      roofrJobId: '88213',
      optedOut: true,
    }
    const summary = summarise(integrityChecks(complete))
    // A percentage would have put this lead in the nineties.
    expect(summary.sentence).toContain('attention')
  })

  it('says so plainly when everything is established', () => {
    const complete: IntegrityEvidence = {
      ...nothing,
      phoneSource: 'homeowner_at_door',
      hasEmail: true,
      callConsentAt: NOW,
      smsConsentAt: NOW,
      stormSource: 'NOAA',
      stormEventAt: '2026-09-01T00:00:00Z',
      imageryCapturedAt: '2026-09-05T00:00:00Z',
      totalKnocks: 2,
      gpsVerifiedKnocks: 2,
      voiceNotes: 1,
      voiceNotesTranscribed: 1,
      roofrJobId: '88213',
    }
    const checks = integrityChecks(complete)
    // Email is deliberately still only 'reported' — nothing confirms an email.
    expect(checks.find((c) => c.key === 'email')?.state).toBe('reported')
    expect(summarise(checks).needsAttention).toBe(0)
  })
})
