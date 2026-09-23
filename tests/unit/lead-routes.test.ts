import { describe, expect, it } from 'vitest'
import {
  groupIntoRoutes,
  orderForWalking,
  splitRoutes,
  UNGROUPED,
  walkingMiles,
} from '@/features/leads/routes'
import type { ScoredLead } from '@/features/leads/scoring'

function door(over: Partial<ScoredLead> & { latitude: number; longitude: number }): ScoredLead {
  return {
    addressKey: `${over.latitude},${over.longitude}`,
    address: '1 SOME ST',
    roofPermit: {} as ScoredLead['roofPermit'],
    score: 50,
    breakdown: [],
    components: { hailSizeInches: 1, daysSinceStorm: 1, distanceMiles: 1, roofAgeYears: 12 },
    storm: {} as ScoredLead['storm'],
    reasons: [],
    ...over,
  } as ScoredLead
}

describe('groupIntoRoutes', () => {
  it('groups by the name the neighbourhood actually goes by', () => {
    // Deliberately not H3 cells or DBSCAN clusters. A rep can say "Santa Maria"
    // to a homeowner and to his manager; he cannot say "cluster 3".
    const routes = groupIntoRoutes([
      door({ latitude: 30.34, longitude: -91.0, subdivision: 'SANTA MARIA' }),
      door({ latitude: 30.341, longitude: -91.001, subdivision: 'SANTA MARIA' }),
      door({ latitude: 30.4, longitude: -91.1, subdivision: 'WILLOWBROOK' }),
    ])
    expect(routes.map((r) => r.name)).toEqual(['SANTA MARIA', 'WILLOWBROOK'])
    expect(routes[0]?.doors).toHaveLength(2)
  })

  it('ranks routes by their best door, not their average or their size', () => {
    // A rep drives to a neighbourhood because of the one door worth driving
    // for. Ranking by average would bury the best door on the whole list
    // behind a larger, flatter route.
    const routes = groupIntoRoutes([
      door({ latitude: 30.3, longitude: -91, subdivision: 'BIG BUT FLAT', score: 40 }),
      door({ latitude: 30.301, longitude: -91, subdivision: 'BIG BUT FLAT', score: 40 }),
      door({ latitude: 30.302, longitude: -91, subdivision: 'BIG BUT FLAT', score: 40 }),
      door({ latitude: 30.4, longitude: -91, subdivision: 'ONE GREAT DOOR', score: 90 }),
      door({ latitude: 30.401, longitude: -91, subdivision: 'ONE GREAT DOOR', score: 20 }),
    ])
    expect(routes[0]?.name).toBe('ONE GREAT DOOR')
  })

  it('breaks a tie on the best door by how much there is to do', () => {
    const routes = groupIntoRoutes([
      door({ latitude: 30.3, longitude: -91, subdivision: 'SMALL', score: 60 }),
      door({ latitude: 30.4, longitude: -91, subdivision: 'LARGE', score: 60 }),
      door({ latitude: 30.401, longitude: -91, subdivision: 'LARGE', score: 55 }),
    ])
    expect(routes[0]?.name).toBe('LARGE')
  })

  it('names the doors with no subdivision rather than dropping them', () => {
    const routes = groupIntoRoutes([door({ latitude: 30.3, longitude: -91 })])
    expect(routes[0]?.name).toBe(UNGROUPED)
  })

  it('reports distance from the rep without reordering by it', () => {
    // A closer route is not a better one. Quietly sorting by distance would
    // hide the best work behind the nearest work.
    const routes = groupIntoRoutes(
      [
        door({ latitude: 30.9, longitude: -91, subdivision: 'FAR BUT BEST', score: 90 }),
        door({ latitude: 30.3, longitude: -91, subdivision: 'NEAR BUT WORSE', score: 30 }),
      ],
      { latitude: 30.3, longitude: -91 },
    )
    expect(routes[0]?.name).toBe('FAR BUT BEST')
    expect(routes[0]?.milesAway).toBeGreaterThan(routes[1]?.milesAway ?? 0)
    expect(routes[1]?.milesAway).toBe(0)
  })

  it('measures how spread out a route is', () => {
    const tight = groupIntoRoutes([
      door({ latitude: 30.34, longitude: -91.0, subdivision: 'TIGHT' }),
      door({ latitude: 30.341, longitude: -91.0, subdivision: 'TIGHT' }),
    ])
    expect(tight[0]?.spreadMiles).toBeLessThan(0.5)
  })
})

describe('orderForWalking', () => {
  it('stops the zigzag', () => {
    // Four doors on a line, handed over in the worst possible order. Score
    // order would walk 1 -> 4 -> 2 -> 3; the walk should just go along it.
    const a = door({ latitude: 30.3, longitude: -91.0, addressKey: 'a', score: 60 })
    const b = door({ latitude: 30.301, longitude: -91.0, addressKey: 'b', score: 30 })
    const c = door({ latitude: 30.302, longitude: -91.0, addressKey: 'c', score: 40 })
    const d = door({ latitude: 30.303, longitude: -91.0, addressKey: 'd', score: 50 })

    const ordered = orderForWalking([a, d, b, c])
    expect(ordered.map((x) => x.addressKey)).toEqual(['a', 'b', 'c', 'd'])
    expect(walkingMiles(ordered)).toBeLessThan(walkingMiles([a, d, b, c]))
  })

  it('starts at the rep when the browser gave a position', () => {
    const near = door({ latitude: 30.3, longitude: -91, addressKey: 'near', score: 10 })
    const far = door({ latitude: 30.35, longitude: -91, addressKey: 'far', score: 99 })
    const ordered = orderForWalking([far, near], { latitude: 30.3, longitude: -91 })
    expect(ordered[0]?.addressKey).toBe('near')
  })

  it('starts at the best door when there is no position', () => {
    // The door the rep most wants to be sure of reaching.
    const ordered = orderForWalking([
      door({ latitude: 30.3, longitude: -91, addressKey: 'low', score: 10 }),
      door({ latitude: 30.31, longitude: -91, addressKey: 'high', score: 99 }),
      door({ latitude: 30.32, longitude: -91, addressKey: 'mid', score: 50 }),
    ])
    expect(ordered[0]?.addressKey).toBe('high')
  })

  it('keeps every door', () => {
    const doors = Array.from({ length: 12 }, (_, i) =>
      door({ latitude: 30.3 + i * 0.002, longitude: -91 + (i % 3) * 0.002, addressKey: `d${i}` }),
    )
    const ordered = orderForWalking(doors)
    expect(ordered).toHaveLength(12)
    expect(new Set(ordered.map((d) => d.addressKey)).size).toBe(12)
  })

  it('handles one door and none at all', () => {
    expect(orderForWalking([])).toEqual([])
    expect(orderForWalking([door({ latitude: 30.3, longitude: -91 })])).toHaveLength(1)
  })
})

describe('splitRoutes', () => {
  it('separates a morning from a single stop', () => {
    // Eleven of twenty-five real groups held one door. Listing a one-door
    // group above a forty-three-door one because its single door scored five
    // points higher is the ranking working and the rep scrolling.
    const routes = groupIntoRoutes([
      door({ latitude: 30.3, longitude: -91, subdivision: 'ONE OFF', score: 99 }),
      door({ latitude: 30.4, longitude: -91, subdivision: 'A MORNING', score: 60 }),
      door({ latitude: 30.401, longitude: -91, subdivision: 'A MORNING', score: 58 }),
      door({ latitude: 30.402, longitude: -91, subdivision: 'A MORNING', score: 57 }),
    ])
    const { worthADrive, singleStops } = splitRoutes(routes)
    expect(worthADrive.map((r) => r.name)).toEqual(['A MORNING'])
    expect(singleStops.map((r) => r.name)).toEqual(['ONE OFF'])
  })

  it('hides nothing — every route lands in one list or the other', () => {
    const routes = groupIntoRoutes([
      door({ latitude: 30.3, longitude: -91, subdivision: 'A' }),
      door({ latitude: 30.4, longitude: -91, subdivision: 'B' }),
      door({ latitude: 30.401, longitude: -91, subdivision: 'B' }),
      door({ latitude: 30.402, longitude: -91, subdivision: 'B' }),
    ])
    const { worthADrive, singleStops } = splitRoutes(routes)
    expect(worthADrive.length + singleStops.length).toBe(routes.length)
  })
})
