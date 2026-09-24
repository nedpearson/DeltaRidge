import { describe, expect, it } from 'vitest'
import {
  fullyDrillable,
  headline,
  oldestObservation,
  prove,
  unproven,
  type ProofRecord,
} from '@/features/proof/proof'
import { SOURCES } from '@/lib/provenance'

const record = (over: Partial<ProofRecord> = {}): ProofRecord => ({
  label: 'NWS Local Storm Report',
  detail: '1.75" hail, 0.8 miles away',
  source: SOURCES.noaaLsr('2026-09-23T00:00:00Z'),
  observedAt: '2026-03-31T21:40:00Z',
  href: '/storm/lsr-1',
  ...over,
})

describe('a claim cannot exist without records', () => {
  it('refuses to establish anything from an empty list', () => {
    const proof = prove('Strong storm evidence', [])
    expect(proof.established).toBe(false)
  })

  it('renders the absence rather than the claim', () => {
    // The whole point: a screen with no evidence shows an empty panel, not a
    // confident sentence with nothing behind it.
    expect(headline(prove('Strong storm evidence', []))).toBe(
      'Strong storm evidence — not established',
    )
    expect(headline(unproven('Roof damage', 'Imagery predates the storm'))).toContain(
      'not established',
    )
  })

  it('has no shape that carries a claim and no records', () => {
    const proof = prove('Anything', [])
    // TypeScript prevents reading .records here; this asserts it at runtime too.
    expect('records' in proof).toBe(false)
  })
})

describe('an established proof', () => {
  const proof = prove('Strong storm evidence', [record(), record({ label: 'NOAA MRMS MESH' })], [
    'Whether hail struck this particular roof',
  ])

  it('counts its records in the headline', () => {
    expect(headline(proof)).toBe('Strong storm evidence (2 records)')
  })

  it('carries what it does not establish', () => {
    expect(proof.established && proof.gaps).toContain('Whether hail struck this particular roof')
  })

  it('reports the OLDEST observation, not the newest', () => {
    // A conclusion is only as current as its oldest load-bearing record. The
    // flattering number is the one nobody should be quoting.
    const mixed = prove('Roof condition', [
      record({ observedAt: '2026-08-01T00:00:00Z' }),
      record({ observedAt: '2023-04-02T00:00:00Z' }),
    ])
    expect(oldestObservation(mixed)).toBe('2023-04-02T00:00:00Z')
  })

  it('ignores an unreadable observation date rather than treating it as now', () => {
    const proof2 = prove('X', [record({ observedAt: 'sometime' }), record({ observedAt: '2026-01-01T00:00:00Z' })])
    expect(oldestObservation(proof2)).toBe('2026-01-01T00:00:00Z')
  })

  it('returns null when nothing carries an observation date', () => {
    const undated = prove('X', [{ label: 'a', detail: 'b', source: SOURCES.rep('2026-09-23T00:00:00Z') }])
    expect(oldestObservation(undated)).toBeNull()
  })
})

describe('fullyDrillable', () => {
  it('is true only when every record can be opened', () => {
    expect(fullyDrillable(prove('X', [record(), record()]))).toBe(true)
  })

  it('is false when any record is a dead end', () => {
    // A proof nobody can check is a slogan.
    const withoutHref: ProofRecord = {
      label: 'A note nobody can open',
      detail: 'Something a rep typed',
      source: SOURCES.rep('2026-09-23T00:00:00Z'),
    }
    expect(fullyDrillable(prove('X', [record(), withoutHref]))).toBe(false)
  })

  it('is false for anything unestablished', () => {
    expect(fullyDrillable(prove('X', []))).toBe(false)
  })
})
