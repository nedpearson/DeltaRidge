import { describe, expect, it } from 'vitest'

// The real arrays, not a copy: a copied list tests nothing.
import { MANAGER_NAV, REP_NAV } from '@/components/AppShell'
import appSource from '../../src/App.tsx?raw'

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
  it('gives both roles a More tab and routes that exist in the app', () => {
    const app = appSource
    for (const NAV of ALL_NAVS) {
      expect(NAV.some((item) => item.to === '/more')).toBe(true)
      for (const item of NAV) expect(app).toContain(`path="${item.to}"`)
    }
  })
})
