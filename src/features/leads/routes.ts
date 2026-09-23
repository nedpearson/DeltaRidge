import { distanceMiles, type ScoredLead } from './scoring'

/**
 * Turning 150 scattered doors into a morning's work.
 *
 * A ranked list is not a route. A rep with 150 addresses spread across five
 * subdivisions and three ZIP codes does not work them in score order — he
 * drives to one neighbourhood, parks, and walks it. Scrolling a list to find
 * which of the next twenty cards happen to be on the same street is work the
 * app should have done.
 *
 * The grouping is by SUBDIVISION rather than by geometry, and that is a
 * deliberate choice against the more sophisticated option. H3 cells or DBSCAN
 * on parcel centroids would produce mathematically tidier clusters with names
 * no human uses. The assessor already labels every parcel with the name the
 * neighbourhood actually goes by — "SANTA MARIA", "HOO SHOO TOO LAKES" — at 99%
 * fill, and a rep knows what those mean, can say them to a homeowner, and can
 * tell his manager where he was. A cluster id cannot do any of that.
 *
 * Within a route the order is a greedy nearest-neighbour walk, and the comment
 * on `orderForWalking` is explicit about what that is and is not.
 */

export interface Route {
  /** The subdivision name, or a stated fallback. Never a generated id. */
  readonly name: string
  readonly doors: readonly ScoredLead[]
  /** Highest priority in the route — what makes it worth driving to. */
  readonly topScore: number
  /** Centre of the doors, for distance-from-here and for the map. */
  readonly latitude: number
  readonly longitude: number
  /** Straight-line miles from the rep, when the browser gave us a position. */
  readonly milesAway?: number
  /** How far apart the doors are. A tight route walks; a loose one drives. */
  readonly spreadMiles: number
}

/** Doors with no subdivision on the roll. Named, not hidden. */
export const UNGROUPED = 'Not in a named subdivision'

function centroid(doors: readonly ScoredLead[]): { lat: number; lon: number } {
  let lat = 0
  let lon = 0
  for (const d of doors) {
    lat += d.latitude
    lon += d.longitude
  }
  return { lat: lat / doors.length, lon: lon / doors.length }
}

/** Farthest door from the middle, doubled: roughly how wide the route is. */
function spread(doors: readonly ScoredLead[], lat: number, lon: number): number {
  let worst = 0
  for (const d of doors) {
    worst = Math.max(worst, distanceMiles(lat, lon, d.latitude, d.longitude))
  }
  return Math.round(worst * 2 * 10) / 10
}

/**
 * Groups doors into routes, best first.
 *
 * "Best" is the top score in the route, not the door count and not the average.
 * A rep drives to a neighbourhood because of the one door worth driving for;
 * the other thirty-nine are why he stays. Ranking by average would bury a
 * route holding the single best door on the list behind a larger, flatter one.
 *
 * `from` is the rep's position when the browser gave one. It does not change
 * the order — a closer route is not a better one, and quietly reordering by
 * distance would hide the best work behind the nearest work. It is reported,
 * so the rep decides.
 */
export function groupIntoRoutes(
  doors: readonly ScoredLead[],
  from?: { latitude: number; longitude: number },
): Route[] {
  const byName = new Map<string, ScoredLead[]>()
  for (const door of doors) {
    const name = door.subdivision?.trim() || UNGROUPED
    const bucket = byName.get(name)
    if (bucket) bucket.push(door)
    else byName.set(name, [door])
  }

  const routes: Route[] = []
  for (const [name, group] of byName) {
    const { lat, lon } = centroid(group)
    routes.push({
      name,
      doors: [...group].sort((a, b) => b.score - a.score),
      topScore: Math.max(...group.map((d) => d.score)),
      latitude: lat,
      longitude: lon,
      spreadMiles: spread(group, lat, lon),
      ...(from
        ? { milesAway: Math.round(distanceMiles(from.latitude, from.longitude, lat, lon) * 10) / 10 }
        : {}),
    })
  }

  return routes.sort((a, b) => {
    if (b.topScore !== a.topScore) return b.topScore - a.topScore
    // A tie on the best door goes to the route with more of them: same reason
    // to drive, more to do when you arrive.
    return b.doors.length - a.doors.length
  })
}

/**
 * Orders the doors of one route into a walk.
 *
 * Greedy nearest neighbour from the starting point, and it is worth being
 * precise about what that means: it is NOT an optimal route. Nearest-neighbour
 * is typically within about 25% of optimal on clustered points and occasionally
 * much worse, because it strands one far door until the end and then walks all
 * the way back for it. Solving it properly is a travelling-salesman problem and
 * a rep with forty doors does not need the last 25%; he needs to stop zigzagging
 * across the same street, which this fixes.
 *
 * It also knows nothing about roads. It does not know about one-way streets,
 * cul-de-sacs, canals, or which side of the road a house is on — it is straight
 * lines between points. In a subdivision that is close enough to be useful and
 * the screen never calls it optimal.
 */
export function orderForWalking(
  doors: readonly ScoredLead[],
  from?: { latitude: number; longitude: number },
): ScoredLead[] {
  // Only a single door short-circuits. Two doors still need ordering when the
  // browser gave a position: the rep should walk to the near one first, and an
  // early return here sent him to the far one because it happened to be listed
  // first. Caught by a test, not by reading the code.
  if (doors.length <= 1) return [...doors]

  const remaining = [...doors]
  const ordered: ScoredLead[] = []

  // With no position from the browser, start at the best door. It is the one
  // the rep most wants to be sure of reaching.
  let cursor = from
  if (!cursor) {
    let bestIndex = 0
    for (let i = 1; i < remaining.length; i += 1) {
      const candidate = remaining[i]
      const incumbent = remaining[bestIndex]
      if (candidate && incumbent && candidate.score > incumbent.score) bestIndex = i
    }
    const [first] = remaining.splice(bestIndex, 1)
    if (first) {
      ordered.push(first)
      cursor = { latitude: first.latitude, longitude: first.longitude }
    }
  }

  while (remaining.length > 0 && cursor) {
    let nearest = 0
    let nearestMiles = Infinity
    for (let i = 0; i < remaining.length; i += 1) {
      const door = remaining[i]
      if (!door) continue
      const miles = distanceMiles(cursor.latitude, cursor.longitude, door.latitude, door.longitude)
      if (miles < nearestMiles) {
        nearestMiles = miles
        nearest = i
      }
    }
    const [next] = remaining.splice(nearest, 1)
    if (!next) break
    ordered.push(next)
    cursor = { latitude: next.latitude, longitude: next.longitude }
  }

  return ordered
}

/** Total straight-line miles of the walk, for an honest "this is a long one". */
export function walkingMiles(ordered: readonly ScoredLead[]): number {
  let total = 0
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]
    const b = ordered[i]
    if (!a || !b) continue
    total += distanceMiles(a.latitude, a.longitude, b.latitude, b.longitude)
  }
  return Math.round(total * 10) / 10
}

/**
 * Below this, a "route" is one stop rather than a morning's work.
 *
 * Three is a judgement, not a measurement. On a real run of 150 doors the
 * parish's own subdivision names produced 25 groups, and eleven of them held a
 * single door. Listing a one-door group above a forty-three-door one because
 * its single door scored five points higher is technically the ranking working
 * and practically a rep scrolling past the morning's work to find it.
 */
export const WORTH_A_DRIVE = 3

/**
 * Splits routes into the ones worth driving to and the ones that are a stop.
 *
 * Both lists keep the same best-door order. Nothing is hidden — a single high
 * scoring door is still a door, and it stays on screen under its own heading
 * rather than being folded into a neighbourhood it is not in.
 */
export function splitRoutes(routes: readonly Route[]): {
  worthADrive: Route[]
  singleStops: Route[]
} {
  return {
    worthADrive: routes.filter((r) => r.doors.length >= WORTH_A_DRIVE),
    singleStops: routes.filter((r) => r.doors.length < WORTH_A_DRIVE),
  }
}
