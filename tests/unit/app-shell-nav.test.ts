import { describe, expect, it } from 'vitest'

const MANAGER_NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/storm-os', label: 'Storm OS', icon: 'storm' },
  { to: '/team', label: 'Team', icon: 'users' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
] as const

const REP_NAV = [
  { to: '/', label: 'Home', icon: 'home' },
  { to: '/map', label: 'Map', icon: 'map' },
  { to: '/inspections', label: 'Jobs', icon: 'clipboard' },
] as const

const ALL_NAVS = [MANAGER_NAV, REP_NAV]

describe('bottom navigation', () => {
  it('has a destination for every entry, with no duplicates', () => {
    for (const NAV of ALL_NAVS) {
      const routes = NAV.map((item) => item.to)
      expect(new Set(routes).size).toBe(routes.length)
    }
  })

  it('stays narrow enough to stay on one row', () => {
    for (const NAV of ALL_NAVS) {
      expect(NAV.length).toBeLessThanOrEqual(5)
    }
  })

  it('gives every entry a label short enough not to wrap the row', () => {
    for (const NAV of ALL_NAVS) {
      for (const item of NAV) {
        expect(item.label.length).toBeLessThanOrEqual(8)
      }
    }
  })
})
