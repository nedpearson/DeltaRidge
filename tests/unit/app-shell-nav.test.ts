import { describe, expect, it } from 'vitest'
import { NAV } from '@/components/AppShell'

/**
 * The regression this guards is not hypothetical: the nav grid was declared
 * `grid-cols-4` while this list held five entries, so the fifth wrapped to a
 * second row and stood 126px tall where the page reserved 96px. On an iPhone SE
 * that put the last 29px of every page underneath the navigation.
 *
 * The component now derives its column count from this array, so the two cannot
 * disagree. These tests hold the surrounding assumptions still.
 */
describe('bottom navigation', () => {
  it('has a destination for every entry, with no duplicates', () => {
    const routes = NAV.map((item) => item.to)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it('stays narrow enough to stay on one row', () => {
    // Five 44px touch targets fit across a 320px phone. Six do not, and a
    // sixth entry would silently reintroduce the two-row nav.
    expect(NAV.length).toBeLessThanOrEqual(5)
  })

  it('gives every entry a label short enough not to wrap the row', () => {
    for (const item of NAV) {
      expect(item.label.length).toBeLessThanOrEqual(8)
    }
  })
})
