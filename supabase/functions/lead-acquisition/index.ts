import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'content-type, x-delta-ridge-token, x-client-info, apikey',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function numberOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function uuidOrNull(value: unknown): string | null {
  const text = stringOrNull(value)
  if (!text) return null
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text
    : null
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: 'Acquisition ingest is not configured on the server.' }, 503)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400)
  }

  const organizationId = uuidOrNull(body.organization_id)
  const token = req.headers.get('x-delta-ridge-token')?.trim() ?? ''
  if (!organizationId || !token) {
    return json({ error: 'organization_id and x-delta-ridge-token are required.' }, 401)
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: settings, error: settingsError } = await db
    .from('acquisition_webhook_settings')
    .select('webhook_secret_hash, enabled')
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (settingsError) return json({ error: 'Webhook configuration lookup failed.' }, 503)
  if (!settings?.enabled || !settings.webhook_secret_hash) {
    return json({ error: 'Acquisition webhook is not enabled for this organization.' }, 403)
  }

  const suppliedHash = await sha256Hex(token)
  if (suppliedHash !== settings.webhook_secret_hash) {
    return json({ error: 'Invalid webhook credential.' }, 401)
  }

  const property =
    body.property && typeof body.property === 'object'
      ? (body.property as Record<string, unknown>)
      : body
  const contact =
    body.contact && typeof body.contact === 'object'
      ? (body.contact as Record<string, unknown>)
      : body

  const sourceChannel = stringOrNull(body.source_channel)
  const eventType = stringOrNull(body.event_type)
  const addressLine1 =
    stringOrNull(property.address_line1) ??
    stringOrNull(property.street) ??
    stringOrNull(property.address)

  if (!sourceChannel || !eventType || !addressLine1) {
    return json(
      { error: 'source_channel, event_type and property.address_line1 are required.' },
      400,
    )
  }

  const occurredAtRaw = stringOrNull(body.occurred_at)
  const occurredAt =
    occurredAtRaw && Number.isFinite(Date.parse(occurredAtRaw))
      ? new Date(occurredAtRaw).toISOString()
      : new Date().toISOString()

  const phoneSource = stringOrNull(contact.phone_source) ?? 'unknown'

  const { data, error } = await db.rpc('ingest_acquisition_lead', {
    p_organization_id: organizationId,
    p_source_channel: sourceChannel,
    p_event_type: eventType,
    p_external_lead_id: stringOrNull(body.external_lead_id),
    p_external_campaign_id: stringOrNull(body.external_campaign_id),
    p_external_ad_id: stringOrNull(body.external_ad_id),
    p_click_id: stringOrNull(body.click_id),
    p_campaign_id: uuidOrNull(body.campaign_id),
    p_occurred_at: occurredAt,
    p_address_line1: addressLine1,
    p_city: stringOrNull(property.city),
    p_state: stringOrNull(property.state) ?? 'LA',
    p_postal_code:
      stringOrNull(property.postal_code) ??
      stringOrNull(property.zip) ??
      stringOrNull(property.postalCode),
    p_latitude: numberOrNull(property.latitude),
    p_longitude: numberOrNull(property.longitude),
    p_first_name: stringOrNull(contact.first_name) ?? stringOrNull(contact.firstName),
    p_last_name: stringOrNull(contact.last_name) ?? stringOrNull(contact.lastName),
    p_phone: stringOrNull(contact.phone),
    p_email: stringOrNull(contact.email),
    p_phone_source: phoneSource,
  })

  if (error) {
    console.error('lead-acquisition ingest failed', error.code, error.message)
    return json({ error: 'Lead acquisition ingest failed.', code: error.code ?? null }, 400)
  }

  const result = Array.isArray(data) ? data[0] : data

  await db
    .from('acquisition_webhook_settings')
    .update({ last_received_at: new Date().toISOString() })
    .eq('organization_id', organizationId)

  return json({
    success: true,
    lead_client_id: result?.lead_client_id ?? null,
    acquisition_event_id: result?.acquisition_event_id ?? null,
    duplicate: result?.duplicate === true,
  })
})
