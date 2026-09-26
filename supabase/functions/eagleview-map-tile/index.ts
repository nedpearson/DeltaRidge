/**
 * Authenticated EagleView WMTS tile proxy.
 *
 * Delta Ridge does not use Mapbox for imagery or maps. EagleView's developer
 * platform provides a WMTS web map tile service for high-resolution ortho
 * imagery. The exact production WMTS URL is entitlement/account specific, so
 * it is supplied as a server-side URL template instead of guessed in source.
 *
 * Required secret:
 *   EAGLEVIEW_WMTS_TILE_URL_TEMPLATE
 *
 * The template may contain either slippy placeholders:
 *   {z} {x} {y}
 * or WMTS names:
 *   {TileMatrix} {TileCol} {TileRow}
 *
 * Credentials and bearer tokens never reach the browser.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CLIENT_ID = Deno.env.get('EAGLEVIEW_CLIENT_ID') ?? ''
const CLIENT_SECRET = Deno.env.get('EAGLEVIEW_CLIENT_SECRET') ?? ''
const WMTS_TEMPLATE = Deno.env.get('EAGLEVIEW_WMTS_TILE_URL_TEMPLATE') ?? ''
const TILE_SIZE = Number(Deno.env.get('EAGLEVIEW_WMTS_TILE_SIZE') ?? '256')
const MIN_ZOOM = Number(Deno.env.get('EAGLEVIEW_WMTS_MIN_ZOOM') ?? '1')
const MAX_ZOOM = Number(Deno.env.get('EAGLEVIEW_WMTS_MAX_ZOOM') ?? '22')
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
  if (!CLIENT_ID || !CLIENT_SECRET) throw new Error('EagleView client credentials are not configured.')
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
  if (typeof body.access_token !== 'string') throw new Error('EagleView did not return an access token.')
  const seconds = typeof body.expires_in === 'number' ? body.expires_in : 3600
  token = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, seconds - 300) * 1000,
  }
  return token.value
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

function tileUrl(z: number, x: number, y: number): string {
  const url = WMTS_TEMPLATE
    .replaceAll('{z}', String(z))
    .replaceAll('{x}', String(x))
    .replaceAll('{y}', String(y))
    .replaceAll('{TileMatrix}', String(z))
    .replaceAll('{TileCol}', String(x))
    .replaceAll('{TileRow}', String(y))

  const parsed = new URL(url)
  if (!(parsed.hostname === 'eagleview.com' || parsed.hostname.endsWith('.eagleview.com'))) {
    throw new Error('EagleView WMTS template must point to an eagleview.com host.')
  }
  return parsed.toString()
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

  if (body['action'] === 'config') {
    return json({
      configured: WMTS_TEMPLATE !== '' && CLIENT_ID !== '' && CLIENT_SECRET !== '',
      tileSize: Number.isFinite(TILE_SIZE) && TILE_SIZE > 0 ? TILE_SIZE : 256,
      minZoom: Number.isFinite(MIN_ZOOM) ? MIN_ZOOM : 1,
      maxZoom: Number.isFinite(MAX_ZOOM) ? MAX_ZOOM : 22,
      provider: 'eagleview',
      message:
        WMTS_TEMPLATE === ''
          ? 'EagleView WMTS tile URL is not configured for this production entitlement.'
          : null,
    })
  }

  if (body['action'] !== 'tile') return json({ error: 'unknown action' }, 400)
  if (!WMTS_TEMPLATE) {
    return json({
      configured: false,
      error: 'EagleView WMTS tile URL is not configured for this production entitlement.',
    }, 503)
  }

  const z = integer(body['z'])
  const x = integer(body['x'])
  const y = integer(body['y'])
  if (z === null || x === null || y === null || z < 0 || z > 30 || x < 0 || y < 0) {
    return json({ error: 'valid z/x/y tile coordinates are required' }, 400)
  }

  try {
    const bearer = await accessToken()
    const response = await fetch(tileUrl(z, x, y), {
      headers: { authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      return json({ error: `EagleView WMTS returned ${response.status}` }, response.status)
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        ...cors,
        'content-type': response.headers.get('content-type') ?? 'image/jpeg',
        'cache-control': 'private, max-age=300',
      },
    })
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : 'EagleView WMTS tile failed',
    }, 504)
  }
})
