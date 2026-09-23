import { describe, expect, it } from 'vitest'
import { isKnown, missing, resolve, SOURCES, sourced, valueOf } from '@/lib/provenance'

const EARLY = SOURCES.ebrParcel('2026-09-01T00:00:00.000Z')
const LATE = SOURCES.ebrParcel('2026-09-23T00:00:00.000Z')
const DOOR = SOURCES.rep('2026-09-10T00:00:00.000Z')

describe('a fact we looked for and did not find', () => {
  it('is not the same as a fact we never looked for', () => {
    const noPermit = missing(LATE, 'No re-roof permit is on file in East Baton Rouge.')
    expect(isKnown(noPermit)).toBe(false)
    expect(valueOf(noPermit)).toBeUndefined()
    // The basis is the whole value of the record: it is what lets the screen
    // say "none on file" rather than leaving a blank a rep will fill in.
    expect(noPermit.basis).toContain('No re-roof permit')
  })
})

describe('resolve', () => {
  it('lets a homeowner outrank a record', () => {
    // Told at the door that the roof was done last year. The permit feed has
    // not caught up and may never. The person standing there wins.
    const permit = sourced(2013, 'verified', LATE)
    const told = sourced(2025, 'stated', DOOR)
    const { chosen } = resolve(permit, told)
    expect(chosen?.value).toBe(2025)
  })

  it('lets a record outrank an estimate however fresh the estimate is', () => {
    const estimate = sourced(12, 'estimated', LATE, 'Years since the original build permit')
    const record = sourced(9, 'verified', EARLY)
    expect(resolve(estimate, record).chosen?.value).toBe(9)
  })

  it('breaks a tie on recency', () => {
    expect(resolve(sourced('A', 'verified', EARLY), sourced('B', 'verified', LATE)).chosen?.value).toBe('B')
  })

  it('keeps the loser when the two disagree', () => {
    // Collapsing a disagreement silently is how a list becomes confidently
    // wrong. The property screen has to be able to show both.
    const { conflicting } = resolve(sourced(2013, 'verified', LATE), sourced(2025, 'stated', DOOR))
    expect(conflicting?.value).toBe(2013)
  })

  it('reports no conflict when the two agree', () => {
    const { conflicting } = resolve(sourced(2013, 'verified', LATE), sourced(2013, 'stated', DOOR))
    expect(conflicting).toBeUndefined()
  })

  it('handles either side being absent', () => {
    const only = sourced(1, 'verified', LATE)
    expect(resolve(only, undefined).chosen).toBe(only)
    expect(resolve(undefined, only).chosen).toBe(only)
    expect(resolve(undefined, undefined).chosen).toBeUndefined()
  })
})
