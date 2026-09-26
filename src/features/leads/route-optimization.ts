import { getSupabase } from '@/lib/supabase'
import type { ScoredLead } from './scoring'

export type RouteProfile = 'walking' | 'driving' | 'driving-traffic' | 'cycling'

export interface RouteOptimization {
  ordered: ScoredLead[]
  distanceMeters: number | null
  durationSeconds: number | null
  method: 'mapbox_exact' | 'mapbox_chunked' | 'fallback'
  warning: string | null
}

interface Point {
  latitude: number
  longitude: number
}

interface OptimizeResponse {
  configured?: boolean
  order?: unknown
  distanceMeters?: unknown
  durationSeconds?: unknown
  error?: unknown
}

const MAX_DOORS_PER_REQUEST = 11

async function optimizeChunk(
  start: Point,
  doors: readonly ScoredLead[],
  profile: RouteProfile,
): Promise<{
  ordered: ScoredLead[]
  distanceMeters: number | null
  durationSeconds: number | null
}> {
  const supabase = getSupabase()
  if (!supabase) throw new Error('The server is not configured for route optimization.')
  if (doors.length === 0) return { ordered: [], distanceMeters: 0, durationSeconds: 0 }

  // Mapbox Optimization v1 needs a fixed destination for a non-roundtrip route.
  // Use the existing greedy last door as the endpoint and let Mapbox reorder
  // the intervening stops using the street network.
  const coordinates = [
    start,
    ...doors.map((door) => ({ latitude: door.latitude, longitude: door.longitude })),
  ]

  const { data, error } = await supabase.functions.invoke('optimize-route', {
    body: { coordinates, profile },
  })
  if (error) throw new Error(error.message)

  const response = (data ?? {}) as OptimizeResponse
  if (typeof response.error === 'string') throw new Error(response.error)

  const order = Array.isArray(response.order)
    ? response.order.filter((value): value is number => Number.isInteger(value))
    : []

  // Input 0 is the starting GPS fix. All remaining indexes address doors at
  // index-1. If Mapbox returns anything malformed, fail closed to the client's
  // existing deterministic order rather than silently dropping a house.
  const doorIndexes = order.filter((index) => index > 0).map((index) => index - 1)
  if (
    doorIndexes.length !== doors.length ||
    new Set(doorIndexes).size !== doors.length ||
    doorIndexes.some((index) => index < 0 || index >= doors.length)
  ) {
    throw new Error('Mapbox returned an incomplete route order.')
  }

  return {
    ordered: doorIndexes.map((index) => doors[index] as ScoredLead),
    distanceMeters:
      typeof response.distanceMeters === 'number' ? response.distanceMeters : null,
    durationSeconds:
      typeof response.durationSeconds === 'number' ? response.durationSeconds : null,
  }
}

/**
 * Road-aware routing with a safe fallback.
 *
 * Mapbox Optimization v1 accepts at most 12 coordinates, so one call can
 * optimize the current position plus 11 doors. Longer neighbourhood routes are
 * processed in sequential chunks based on the existing local walking order.
 * That is road-aware within each chunk, but not a claim of global optimality.
 */
export async function optimizeDoorRoute(input: {
  start: Point
  doors: readonly ScoredLead[]
  profile?: RouteProfile
}): Promise<RouteOptimization> {
  const profile = input.profile ?? 'walking'
  if (input.doors.length <= 1) {
    return {
      ordered: [...input.doors],
      distanceMeters: 0,
      durationSeconds: 0,
      method: 'fallback',
      warning: null,
    }
  }

  try {
    if (input.doors.length <= MAX_DOORS_PER_REQUEST) {
      const result = await optimizeChunk(input.start, input.doors, profile)
      return {
        ...result,
        method: 'mapbox_exact',
        warning: null,
      }
    }

    const ordered: ScoredLead[] = []
    let distanceMeters = 0
    let durationSeconds = 0
    let hasDistance = true
    let hasDuration = true
    let start = input.start

    for (let offset = 0; offset < input.doors.length; offset += MAX_DOORS_PER_REQUEST) {
      const chunk = input.doors.slice(offset, offset + MAX_DOORS_PER_REQUEST)
      const result = await optimizeChunk(start, chunk, profile)
      ordered.push(...result.ordered)

      if (result.distanceMeters === null) hasDistance = false
      else distanceMeters += result.distanceMeters

      if (result.durationSeconds === null) hasDuration = false
      else durationSeconds += result.durationSeconds

      const last = result.ordered[result.ordered.length - 1]
      if (last) start = { latitude: last.latitude, longitude: last.longitude }
    }

    return {
      ordered,
      distanceMeters: hasDistance ? distanceMeters : null,
      durationSeconds: hasDuration ? durationSeconds : null,
      method: 'mapbox_chunked',
      warning:
        'This route is longer than Mapbox Optimization v1 can solve in one request. Delta Ridge optimized sequential street-aware chunks, not one global route.',
    }
  } catch (error) {
    return {
      ordered: [...input.doors],
      distanceMeters: null,
      durationSeconds: null,
      method: 'fallback',
      warning:
        error instanceof Error
          ? `Road-aware optimization unavailable: ${error.message}`
          : 'Road-aware optimization unavailable. Using the local walking order.',
    }
  }
}

export function routeMethodLabel(method: RouteOptimization['method']): string {
  switch (method) {
    case 'mapbox_exact':
      return 'Street-aware walking order'
    case 'mapbox_chunked':
      return 'Street-aware chunked order'
    case 'fallback':
      return 'Local nearest-door order'
  }
}
