/**
 * Authenticated EagleView Imagery API proxy.
 *
 * Client credentials and short-lived access tokens stay here. The browser gets
 * normalized capture metadata and image bytes, never a provider credential or
 * a reusable EagleView URL.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CLIENT_ID = Deno.env.get('EAGLEVIEW_CLIENT_ID') || '0oa1dzngpw5pdHynn2p8'
const CLIENT_SECRET = Deno.env.get('EAGLEVIEW_CLIENT_SECRET') || Deno.env.get('0oa1dzngpw5pdHynn2p8') || ''
const ENVIRONMENT = Deno.env.get('EAGLEVIEW_ENV') === 'sandbox' ? 'sandbox' : 'production'
const API = ENVIRONMENT === 'sandbox'
  ? 'https://sandbox.apis.eagleview.com'
  : 'https://apis.eagleview.com'
const TOKEN_URL = 'https://apicenter.eagleview.com/oauth2/v1/token'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

let token: { value: string; expiresAt: number } | null = null

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

async function accessToken(): Promise<string> {
  if (token !== null && token.expiresAt > Date.now() + 60_000) return token.value
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`)
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      authorization: `Basic ${basic}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`EagleView authentication returned ${response.status}`)
  const body = await response.json() as { access_token?: unknown; expires_in?: unknown }
  if (typeof body.access_token !== 'string') throw new Error('EagleView did not return an access token')
  const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600
  token = { value: body.access_token, expiresAt: Date.now() + Math.max(60, seconds - 300) * 1000 }
  return token.value
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function bool(value: unknown): boolean {
  return value === true
}

function gsd(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (value === null || typeof value !== 'object') return null
  const metres = (value as Record<string, unknown>)['value']
  return typeof metres === 'number' && Number.isFinite(metres) ? metres : null
}

type View = 'ortho' | 'north' | 'east' | 'south' | 'west'

function imagesFrom(container: unknown): Record<string, unknown>[] {
  if (container === null || typeof container !== 'object') return []
  const images = (container as Record<string, unknown>)['images']
  return Array.isArray(images)
    ? images.filter((image): image is Record<string, unknown> => image !== null && typeof image === 'object')
    : []
}

function normalize(raw: unknown): Record<string, unknown>[] {
  if (raw === null || typeof raw !== 'object') return []
  const body = raw as Record<string, unknown>
  const captures = Array.isArray(body['captures']) ? body['captures'] : []
  const rows: Record<string, unknown>[] = []
  for (const item of captures) {
    if (item === null || typeof item !== 'object') continue
    const outer = item as Record<string, unknown>
    // The quick-start sample wraps views; the current OpenAPI response puts
    // orthos/obliques beside capture. Accept both so an API doc drift does not
    // turn every location into a false "no imagery" result.
    const view = (outer['views'] ?? outer) as Record<string, unknown>
    const capture = (outer['capture'] ?? {}) as Record<string, unknown>
    const captureId = string(capture['urn']) ?? `${string(capture['start_date']) ?? 'unknown'}:${string(capture['end_date']) ?? 'unknown'}`
    const labels = Array.isArray(capture['labels']) ? capture['labels'] : []
    const add = (kind: View, image: Record<string, unknown>) => {
      const urn = string(image['urn']) ?? string(image['image_urn'])
      if (urn === null) return
      rows.push({
        provider: 'eagleview',
        captureId,
        imageUrn: urn,
        capturedFrom: string(capture['start_date']) ?? string(image['shot_time']),
        capturedUntil: string(capture['end_date']) ?? string(image['shot_time']),
        publishedAt: string(image['first_published_time']),
        gsdMetres: gsd(image['calculated_gsd']),
        composite: bool(image['composite']),
        disaster: labels.includes('CAPTURE_LABEL_DISASTER'),
        view: kind,
      })
    }
    for (const image of imagesFrom(view['orthos'])) add('ortho', image)
    const obliques = (view['obliques'] ?? {}) as Record<string, unknown>
    for (const kind of ['north', 'east', 'south', 'west'] as const) {
      for (const image of imagesFrom(obliques[kind])) add(kind, image)
    }
  }
  return rows
}

function validCoordinate(value: unknown, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= low && value <= high
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...cors,
        'access-control-allow-headers': req.headers.get('access-control-request-headers') ?? cors['access-control-allow-headers'],
      },
    })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (SUPABASE_URL === '' || ANON_KEY === '' || SERVICE_ROLE_KEY === '') return json({ error: 'server not configured' }, 500)

  const authorization = req.headers.get('authorization')
  if (authorization === null) return json({ error: 'sign in first' }, 401)
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: auth } = await asCaller.auth.getUser()
  if (auth.user === null) return json({ error: 'sign in first' }, 401)
  const { data: membership } = await asCaller
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (membership === null) return json({ error: 'organization access required' }, 403)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return json({ error: 'body was not JSON' }, 400)
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const action = string(body['action']) ?? 'unknown'
  const { data: requestRow } = await db.from('imagery_requests').insert({
    organization_id: membership.organization_id,
    provider: 'eagleview',
    action,
    requested_by: auth.user.id,
    status: CLIENT_ID === '' || CLIENT_SECRET === '' ? 'not_configured' : 'started',
    requested_location:
      typeof body['latitude'] === 'number' && typeof body['longitude'] === 'number'
        ? `POINT(${body['longitude']} ${body['latitude']})`
        : null,
  }).select('id').maybeSingle()
  const requestId = requestRow?.id as string | undefined

  if (CLIENT_ID === '' || CLIENT_SECRET === '') {
    return json({
      configured: false,
      captures: [],
      nextCaptureToken: null,
      message: 'EagleView developer credentials are not configured. A MyEagleView report account is separate from Imagery API access.',
    })
  }

  const latitude = body['latitude']
  const longitude = body['longitude']
  if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) {
    if (requestId !== undefined) {
      await db.from('imagery_requests').update({
        status: 'failed', error_summary: 'valid latitude and longitude are required', completed_at: new Date().toISOString(),
      }).eq('id', requestId)
    }
    return json({ error: 'valid latitude and longitude are required' }, 400)
  }

  try {
    const bearer = await accessToken()
    if (body['action'] === 'search') {
      const filter: Record<string, unknown> = {}
      const from = string(body['from'])
      const until = string(body['until'])
      if (from !== null || until !== null) {
        filter['date'] = { ...(from !== null ? { since: from } : {}), ...(until !== null ? { until } : {}) }
      }
      const next = string(body['nextCaptureToken'])
      if (next !== null) filter['next_capture_token'] = next
      const point = JSON.stringify({
        type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: null,
      })
      const response = await fetch(`${API}/imagery/v3/discovery/rank/location`, {
        method: 'POST',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          center: { point: { geojson: { value: point, epsg: 'EPSG:4326' } }, radius_in_meters: 50 },
          view: { orthos: {}, obliques: {}, max_images_per_view: 3 },
          capture: { filter },
          response_props: {
            first_published_time: true,
            composite: true,
            shot_time: true,
            calculated_gsd: true,
            look_at: true,
          },
        }),
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) throw new Error(`EagleView discovery returned ${response.status}`)
      const payload = await response.json() as Record<string, unknown>
      const captures = normalize(payload)
      if (requestId !== undefined) {
        await db.from('imagery_requests').update({
          status: 'succeeded', response_count: captures.length, completed_at: new Date().toISOString(),
        }).eq('id', requestId)
      }
      if (captures.length > 0) {
        await db.from('imagery_captures').upsert(captures.map((capture) => ({
          organization_id: membership.organization_id,
          provider: capture['provider'],
          capture_id: capture['captureId'],
          image_urn: capture['imageUrn'],
          captured_from: capture['capturedFrom'],
          captured_until: capture['capturedUntil'],
          published_at: capture['publishedAt'],
          resolution_gsd_m: capture['gsdMetres'],
          view_type: capture['view'],
          composite: capture['composite'],
          disaster_capture: capture['disaster'],
          last_seen_at: new Date().toISOString(),
        })), { onConflict: 'organization_id,provider,image_urn' })
      }
      return json({
        configured: true,
        captures,
        nextCaptureToken: string(payload['next_capture_token']),
        message: captures.length === 0 ? 'EagleView returned no imagery for this location and entitlement.' : null,
      })
    }

    if (body['action'] === 'image') {
      const urn = string(body['imageUrn'])
      if (urn === null || !urn.startsWith('urn:eagleview.com:')) return json({ error: 'valid image URN required' }, 400)
      const radius = typeof body['radiusMetres'] === 'number'
        ? Math.min(100, Math.max(10, Math.round(body['radiusMetres'])))
        : 35
      const params = new URLSearchParams({
        'center.x': String(longitude),
        'center.y': String(latitude),
        'center.radius': String(radius),
        epsg: 'EPSG:4326',
        'size.width': '2048',
        'size.height': '2048',
        format: 'IMAGE_FORMAT_JPEG',
        quality: '90',
        scale: 'IMAGE_SCALE_AUTO',
      })
      const response = await fetch(`${API}/imagery/v3/images/${encodeURIComponent(urn)}/location?${params}`, {
        headers: { authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) throw new Error(`EagleView image returned ${response.status}`)
      if (requestId !== undefined) {
        await db.from('imagery_requests').update({
          status: 'succeeded', response_count: 1, completed_at: new Date().toISOString(),
        }).eq('id', requestId)
      }
      return new Response(response.body, {
        status: 200,
        headers: {
          ...cors,
          'content-type': response.headers.get('content-type') ?? 'image/jpeg',
          'cache-control': 'private, max-age=300',
          'x-image-scale': response.headers.get('x-image-scale') ?? 'unknown',
        },
      })
    }
    if (requestId !== undefined) {
      await db.from('imagery_requests').update({
        status: 'failed', error_summary: 'unknown action', completed_at: new Date().toISOString(),
      }).eq('id', requestId)
    }
    return json({ error: 'unknown action' }, 400)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'EagleView request failed'
    if (requestId !== undefined) {
      await db.from('imagery_requests').update({
        status: 'failed', error_summary: message.slice(0, 240), completed_at: new Date().toISOString(),
      }).eq('id', requestId)
    }
    return json({ error: message }, /authentication/i.test(message) ? 502 : 504)
  }
})
