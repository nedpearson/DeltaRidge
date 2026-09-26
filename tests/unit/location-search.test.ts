import { describe, expect, it } from 'vitest'
import { bboxAround, withinRadiusMiles } from '@/features/leads/location-search'

describe('current-location search geometry', () => {
  const batonRouge = { latitude: 30.4515, longitude: -91.1871 }

  it('builds a bbox around the actual search center', () => {
    const [west, south, east, north] = bboxAround(batonRouge, 5)
    expect(west).toBeLessThan(batonRouge.longitude)
    expect(east).toBeGreaterThan(batonRouge.longitude)
    expect(south).toBeLessThan(batonRouge.latitude)
    expect(north).toBeGreaterThan(batonRouge.latitude)
  })

  it('includes nearby points and excludes points outside the radius', () => {
    expect(
      withinRadiusMiles(
        { latitude: 30.46, longitude: -91.18 },
        batonRouge,
        5,
      ),
    ).toBe(true)

    expect(
      withinRadiusMiles(
        { latitude: 30.6, longitude: -91.18 },
        batonRouge,
        5,
      ),
    ).toBe(false)
  })
})
