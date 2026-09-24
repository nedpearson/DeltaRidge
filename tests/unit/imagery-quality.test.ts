import { describe, expect, it } from 'vitest'
import { assessImagery, captureLabel, type ImageryFacts } from '@/features/claims/imagery-quality'

const facts = (over: Partial<ImageryFacts> = {}): ImageryFacts => ({
  gsdMetres: 0.05,
  capturedFrom: '2026-04-10T00:00:00Z',
  capturedUntil: null,
  composite: false,
  source: 'EagleView',
  obstructedFraction: null,
  ...over,
})

const STORM = { occurredAt: '2026-03-31T21:40:00Z' }

describe('hail cannot be confirmed from the air, at any resolution EagleView sells', () => {
  it('refuses at 6 inch, 3 inch, 2 inch and their finest sub-inch aerial', () => {
    // 0.75" is EagleView's finest published aerial GSD. A hail bruise is
    // smaller than the pixel, so the answer is the same all the way down.
    for (const metres of [0.15, 0.08, 0.05, 0.019]) {
      const verdict = assessImagery(facts({ gsdMetres: metres }), 'hail_impact', STORM)
      expect(verdict.ok).toBe(false)
    }
  })

  it('says so in inches a rep can repeat, and says what would work', () => {
    const verdict = assessImagery(facts({ gsdMetres: 0.05 }), 'hail_impact', STORM)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toMatch(/2\.0 inches/)
    expect(verdict.reason).toMatch(/cannot show one either way/)
    expect(verdict.instead).toMatch(/drone|roof/i)
  })

  it('allows it only at drone resolution', () => {
    expect(assessImagery(facts({ gsdMetres: 0.001 }), 'hail_impact', STORM).ok).toBe(true)
  })
})

describe('what aerial imagery can carry', () => {
  it('allows gross damage at standard aerial resolution', () => {
    expect(assessImagery(facts({ gsdMetres: 0.15 }), 'gross_damage', STORM).ok).toBe(true)
  })

  it('refuses repair history at six inch but allows it at three', () => {
    expect(assessImagery(facts({ gsdMetres: 0.15 }), 'repair_history', STORM).ok).toBe(false)
    expect(assessImagery(facts({ gsdMetres: 0.07 }), 'repair_history', STORM).ok).toBe(true)
  })
})

describe('dates', () => {
  it('refuses imagery taken before the storm as evidence of storm damage', () => {
    const before = facts({ capturedFrom: '2026-02-01T00:00:00Z' })
    const verdict = assessImagery(before, 'gross_damage', STORM)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    // Still useful — as the other half of a comparison.
    expect(verdict.instead).toMatch(/before/i)
  })

  it('refuses imagery with no capture date at all', () => {
    expect(assessImagery(facts({ capturedFrom: null }), 'gross_damage', STORM).ok).toBe(false)
  })

  it('judges a composite by the END of its window', () => {
    // A composite whose window straddles the storm cannot be said to post-date
    // it on its start date alone.
    const straddling = facts({
      composite: true,
      capturedFrom: '2026-03-28T00:00:00Z',
      capturedUntil: '2026-04-04T00:00:00Z',
    })
    expect(assessImagery(straddling, 'gross_damage', STORM).ok).toBe(true)

    const wholly = facts({
      composite: true,
      capturedFrom: '2026-03-20T00:00:00Z',
      capturedUntil: '2026-03-25T00:00:00Z',
    })
    expect(assessImagery(wholly, 'gross_damage', STORM).ok).toBe(false)
  })
})

describe('captureLabel', () => {
  it('never says live or current', () => {
    for (const f of [
      facts(),
      facts({ composite: true, capturedUntil: '2026-04-14T00:00:00Z' }),
      facts({ capturedFrom: null }),
    ]) {
      expect(captureLabel(f)).not.toMatch(/\blive\b|\bcurrent\b/i)
    }
  })

  it('gives a single date for a single capture', () => {
    expect(captureLabel(facts())).toContain('captured Apr 10, 2026')
  })

  it('gives a window for a composite, because no single date is true of it', () => {
    // EagleView's own spec warns shot_time is unreliable for composites.
    const label = captureLabel(
      facts({ composite: true, capturedFrom: '2026-04-10T00:00:00Z', capturedUntil: '2026-04-14T00:00:00Z' }),
    )
    expect(label).toContain('between Apr 10, 2026 and Apr 14, 2026')
  })

  it('says plainly when no date was supplied', () => {
    expect(captureLabel(facts({ capturedFrom: null }))).toMatch(/not supplied/)
  })
})

describe('obstruction', () => {
  it('refuses when most of the roof is under a tree', () => {
    expect(assessImagery(facts({ obstructedFraction: 0.45 }), 'gross_damage', STORM).ok).toBe(false)
  })

  it('allows with a caveat when a little is obscured', () => {
    const verdict = assessImagery(facts({ obstructedFraction: 0.15 }), 'gross_damage', STORM)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.caveat).toMatch(/15%/)
  })
})

describe('unknown resolution', () => {
  it('refuses rather than assuming the picture is good enough', () => {
    expect(assessImagery(facts({ gsdMetres: null }), 'gross_damage', STORM).ok).toBe(false)
  })
})
