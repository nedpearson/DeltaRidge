/**
 * Authenticated Mapbox Optimization proxy for field routes.
 *
 * Browser tokens are URL-restricted and belong to rendering. Route planning
 * uses a server-side Mapbox token so the credential never ships in the PWA and
 * the request can be audited/throttled centrally.
 *
 * Mapbox Optimization v1 accepts 2-12 coordinates. The client therefore sends
 * at most one start + 11 doors per call.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const MAPBOX_TOKEN = Deno.env.get('MAPBOX_SECRET_TOKEN') ?? ''

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

interface Point {
  longitude: number
  latitude: number
}

function coordinate(value: unknown): Point | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const longitude = row['longitude']
  const latitude = row['latitude']
  if (
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90
  ) return null
  return { longitude, latitude }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...cors,
        'access-control-allow-headers':
          req.headers.get('access-control-request-headers') ??
          cors['access-control-allow-headers'],
      },
    })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SUPABASE_URL || !ANON_KEY) return json({ error: 'server not configured' }, 500)
  if (!MAPBOX_TOKEN) {
    return json({
      configured: false,
      error: 'Road-aware route optimization is not configured on the server.',
    }, 503)
  }

  const authorization = req.headers.get('authorization')
  if (!authorization) return json({ error: 'authentication required' }, 401)

  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth, error: authError } = await caller.auth.getUser()
  if (authError || !auth?.user) return json({ error: 'invalid session' }, 401)

  const { data: membership } = await caller
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (!membership?.organization_id) {
    return json({ error: 'active organization membership required' }, 403)
  }

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const raw = Array.isArray(body['coordinates']) ? body['coordinates'] : []
  const coordinates = raw.map(coordinate)
  if (coordinates.some((point) => point === null)) {
    return json({ error: 'all coordinates must contain valid latitude and longitude' }, 400)
  }
  const points = coordinates as Point[]
  if (points.length < 2 || points.length > 12) {
    return json({ error: 'Mapbox Optimization v1 requires 2 to 12 coordinates per request' }, 400)
  }

  const requestedProfile = body['profile']
  const profile =
    requestedProfile === 'driving' ||
    requestedProfile === 'driving-traffic' ||
    requestedProfile === 'cycling'
      ? requestedProfile
      : 'walking'

  const encoded = points
    .map((point) => `${point.longitude.toFixed(6)},${point.latitude.toFixed(6)}`)
    .join(';')
  const params = new URLSearchParams({
    access_token: MAPBOX_TOKEN,
    source: 'first',
    roundtrip: 'false',
    destination: 'last',
    overview: 'full',
    geometries: 'geojson',
    steps: 'false',
  })

  const url =
    `https://api.mapbox.com/optimized-trips/v1/mapbox/${profile}/${encoded}?${params.toString()}`

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
    const payload = await response.json() as Record<string, unknown>
    if (!response.ok || payload['code'] !== 'Ok') {
      const message =
        typeof payload['message'] === 'string'
          ? payload['message']
          : `Mapbox route optimization returned HTTP ${response.status}`
      return json({ error: message }, response.status >= 400 ? response.status : 502)
    }

    const trips = Array.isArray(payload['trips']) ? payload['trips'] : []
    const trip =
      trips[0] && typeof trips[0] === 'object'
        ? trips[0] as Record<string, unknown>
        : null
    const waypoints = Array.isArray(payload['waypoints']) ? payload['waypoints'] : []

    if (!trip) return json({ error: 'Mapbox returned no optimized trip' }, 502)

    const order = waypoints
      .map((waypoint, inputIndex) => {
        if (!waypoint || typeof waypoint !== 'object') return null
        const index = (waypoint as Record<string, unknown>)['waypoint_index']
        return typeof index === 'number' ? { inputIndex, tripIndex: index } : null
      })
      .filter((value): value is { inputIndex: number; tripIndex: number } => value !== null)
      .sort((a, b) => a.tripIndex - b.tripIndex)
      .map((value) => value.inputIndex)

    return json({
      configured: true,
      profile,
      order,
      distanceMeters: typeof trip['distance'] === 'number' ? trip['distance'] : null,
      durationSeconds: typeof trip['duration'] === 'number' ? trip['duration'] : null,
      geometry:
        trip['geometry'] && typeof trip['geometry'] === 'object'
          ? trip['geometry']
          : null,
    })
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'Mapbox route optimization failed',
    }, 504)
  }
})
