import { currentPosition } from '@/lib/image'

export interface SearchCenter {
  latitude: number
  longitude: number
  accuracyM: number | null
  capturedAt: string
}

export type LocationSearchState =
  | { kind: 'ready'; center: SearchCenter }
  | { kind: 'locating' }
  | { kind: 'denied'; message: string }
  | { kind: 'unavailable'; message: string }

const EARTH_RADIUS_MILES = 3958.8

export function bboxAround(
  center: Pick<SearchCenter, 'latitude' | 'longitude'>,
  radiusMiles: number,
): [number, number, number, number] {
  const radius = Math.max(0.1, radiusMiles)
  const latDelta = (radius / EARTH_RADIUS_MILES) * (180 / Math.PI)
  const cosLat = Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180))
  const lonDelta = latDelta / cosLat
  return [
    center.longitude - lonDelta,
    center.latitude - latDelta,
    center.longitude + lonDelta,
    center.latitude + latDelta,
  ]
}

export function withinRadiusMiles(
  point: { latitude: number; longitude: number },
  center: Pick<SearchCenter, 'latitude' | 'longitude'>,
  radiusMiles: number,
): boolean {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = toRad(point.latitude - center.latitude)
  const dLon = toRad(point.longitude - center.longitude)
  const lat1 = toRad(center.latitude)
  const lat2 = toRad(point.latitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  const miles = 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
  return miles <= radiusMiles
}

async function permissionState(): Promise<PermissionState | 'unknown'> {
  try {
    if (!('permissions' in navigator) || typeof navigator.permissions.query !== 'function') {
      return 'unknown'
    }
    const result = await navigator.permissions.query({ name: 'geolocation' })
    return result.state
  } catch {
    return 'unknown'
  }
}

export async function acquireSearchCenter(timeoutMs = 7000): Promise<LocationSearchState> {
  const permission = await permissionState()
  if (permission === 'denied') {
    return {
      kind: 'denied',
      message:
        'Location permission is blocked for this site. Turn Location Services on for Delta Ridge in your browser or device settings, then try again.',
    }
  }

  const position = await currentPosition(timeoutMs)
  if (!position) {
    return {
      kind: 'unavailable',
      message:
        permission === 'prompt'
          ? 'Location was not provided. Allow Location Services to build nearby roofing opportunities.'
          : 'Current location could not be acquired. Check Location Services and GPS, then try again.',
    }
  }

  return {
    kind: 'ready',
    center: {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyM: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
      capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
    },
  }
}
