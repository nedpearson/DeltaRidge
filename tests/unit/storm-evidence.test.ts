import { describe, expect, it } from 'vitest'
import { checkLanguage } from '@/features/claims/language'
import {
  assessStorm,
  MATERIAL_HAIL_INCHES,
  NEARBY_MILES,
  type GroundReport,
  type RadarEstimate,
} from '@/features/claims/storm-evidence'

const report = (over: Partial<GroundReport> = {}): GroundReport => ({
  hailInches: 1.75,
  distanceMiles: 0.8,
  occurredAt: '2026-03-31T21:40:00Z',
  source: 'NWS Local Storm Report',
  ...over,
})

const radar = (over: Partial<RadarEstimate> = {}): RadarEstimate => ({
  meshInches: 1.42,
  overProperty: true,
  occurredAt: '2026-03-31T21:35:00Z',
  source: 'NOAA MRMS MESH',
  ...over,
})

describe('tiers', () => {
  it('A when a nearby report and radar over the property agree', () => {
    expect(assessStorm([report()], radar()).tier).toBe('A')
  })

  it('B on a nearby report alone', () => {
    expect(assessStorm([report()], null).tier).toBe('B')
    expect(assessStorm([report()], radar({ overProperty: false })).tier).toBe('B')
  })

  it('C on radar alone, and says nobody saw it', () => {
    const evidence = assessStorm([], radar())
    expect(evidence.tier).toBe('C')
    expect(evidence.sentence).toMatch(/no one reported/i)
  })

  it('D when the only report is too far to be about this address', () => {
    const evidence = assessStorm([report({ distanceMiles: 6 })], null)
    expect(evidence.tier).toBe('D')
    expect(evidence.sentence).toMatch(/too far away/i)
  })

  it('E with nothing material', () => {
    expect(assessStorm([], null).tier).toBe('E')
  })

  it('ignores hail too small to damage a shingle roof', () => {
    const pea = report({ hailInches: MATERIAL_HAIL_INCHES - 0.25 })
    expect(assessStorm([pea], null).tier).toBe('E')
    expect(assessStorm([], radar({ meshInches: 0.5 })).tier).toBe('E')
  })

  it('treats the distance threshold as a boundary, not a suggestion', () => {
    expect(assessStorm([report({ distanceMiles: NEARBY_MILES })], null).tier).toBe('B')
    expect(assessStorm([report({ distanceMiles: NEARBY_MILES + 0.01 })], null).tier).toBe('D')
  })

  it('picks the nearest qualifying report, not the first or the biggest', () => {
    const evidence = assessStorm(
      [report({ distanceMiles: 1.8, hailInches: 2.5 }), report({ distanceMiles: 0.3, hailInches: 1.25 })],
      null,
    )
    expect(evidence.nearestReport?.distanceMiles).toBe(0.3)
  })
})

describe('the sentence it produces', () => {
  it('never says hail hit the house', () => {
    for (const evidence of [
      assessStorm([report()], radar()),
      assessStorm([report()], null),
      assessStorm([], radar()),
      assessStorm([report({ distanceMiles: 9 })], null),
      assessStorm([], null),
    ]) {
      expect(evidence.sentence).not.toMatch(/hit (your|this)/i)
      expect(evidence.sentence).not.toMatch(/struck (your|this)/i)
      // And the accurate version has to survive the language guard.
      expect(checkLanguage(evidence.sentence).ok).toBe(true)
    }
  })

  it('carries the distance and the source on a ground report', () => {
    const evidence = assessStorm([report()], null)
    expect(evidence.sentence).toContain('0.8 miles away')
    expect(evidence.sentence).toContain('NWS Local Storm Report')
  })

  it('says "estimated" for radar and never presents it as an observation', () => {
    const evidence = assessStorm([], radar())
    expect(evidence.sentence).toMatch(/estimated/i)
    expect(evidence.sentence).toContain('NOAA MRMS MESH')
    expect(evidence.sentence).not.toMatch(/\breported\b.*MESH/i)
  })

  it('keeps the two sources separate rather than averaging them', () => {
    // A ground report and a radar estimate are different kinds of statement;
    // one blended number would be neither.
    const evidence = assessStorm([report({ hailInches: 1.75 })], radar({ meshInches: 1.42 }))
    expect(evidence.sentence).toContain('1.75')
    expect(evidence.sentence).toContain('1.42')
    expect(evidence.sentence).not.toContain('1.58') // the average
  })

  it('handles a report essentially on top of the property without claiming a direct hit', () => {
    const evidence = assessStorm([report({ distanceMiles: 0.05 })], null)
    expect(evidence.sentence).toMatch(/less than 0\.1 miles away/)
    expect(evidence.sentence).not.toMatch(/hit/i)
  })

  it('gives a reason for every tier, for the why drill-down', () => {
    for (const evidence of [
      assessStorm([report()], radar()),
      assessStorm([report()], null),
      assessStorm([], radar()),
      assessStorm([report({ distanceMiles: 9 })], null),
      assessStorm([], null),
    ]) {
      expect(evidence.because.length).toBeGreaterThan(20)
    }
  })
})
