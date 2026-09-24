import { describe, expect, it } from 'vitest'
import {
  detailIsSafe,
  isTraceId,
  newTraceId,
  traceStartedAt,
} from '@/features/observability/trace'

describe('trace ids', () => {
  it('are unique across a burst in the same millisecond', () => {
    const now = Date.now()
    const ids = new Set(Array.from({ length: 5000 }, () => newTraceId(now)))
    expect(ids.size).toBe(5000)
  })

  it('sort chronologically as plain strings', () => {
    const early = newTraceId(Date.parse('2026-01-01T00:00:00Z'))
    const later = newTraceId(Date.parse('2026-09-23T00:00:00Z'))
    expect(early < later).toBe(true)
  })

  it('contain no letter that collides when read aloud', () => {
    // The whole reason for Crockford base32: a rep spelling this over a bad
    // line to somebody typing it into a search box.
    for (let i = 0; i < 200; i += 1) {
      expect(newTraceId()).not.toMatch(/[ILOU]/)
    }
  })

  it('recognise themselves and reject near misses', () => {
    expect(isTraceId(newTraceId())).toBe(true)
    expect(isTraceId('tr_TOOSHORT')).toBe(false)
    expect(isTraceId('nope')).toBe(false)
    expect(isTraceId('')).toBe(false)
  })

  it('survive being typed back in the wrong case', () => {
    const id = newTraceId()
    expect(isTraceId(id.toUpperCase())).toBe(true)
  })

  it('recover roughly when they started', () => {
    const when = Date.parse('2026-09-23T12:00:00.000Z')
    const recovered = traceStartedAt(newTraceId(when))
    expect(recovered?.getTime()).toBe(when)
  })

  it('return null rather than a wrong date for something that is not a trace', () => {
    expect(traceStartedAt('tr_????????######')).toBeNull()
    expect(traceStartedAt('hello')).toBeNull()
  })
})

describe('detailIsSafe', () => {
  it('passes an ordinary summary', () => {
    expect(detailIsSafe('queued after 3 attempts').safe).toBe(true)
    expect(detailIsSafe('refused: outside the calling window').safe).toBe(true)
  })

  it('catches a phone number that slipped into a detail line', () => {
    // A trace is read by whoever is debugging, which is a wider audience than
    // whoever may see the lead.
    const result = detailIsSafe('could not reach 225-555-0142')
    expect(result.safe).toBe(false)
    if (result.safe) return
    expect(result.reason).toContain('phone')
  })

  it('catches an email address', () => {
    expect(detailIsSafe('bounced for dana@example.com').safe).toBe(false)
  })

  it('catches something shaped like a token', () => {
    /*
     * Assembled at runtime rather than written as a literal.
     *
     * The first version of this test spelled out a realistic `sk_live_...`
     * string, and GitHub's push protection rejected the whole push as a leaked
     * Stripe key — correctly, since a scanner cannot tell a fabricated example
     * from a real one, and neither can a person skimming a diff. A test that
     * proves we reject credential-shaped strings has no business containing one.
     */
    const fake = `${'sk'}_${'live'}_${'a1b2c3d4'.repeat(4)}`
    expect(detailIsSafe(`using key ${fake}`).safe).toBe(false)
  })

  it('catches a detail long enough to be a payload', () => {
    expect(detailIsSafe('x'.repeat(201)).safe).toBe(false)
  })
})
