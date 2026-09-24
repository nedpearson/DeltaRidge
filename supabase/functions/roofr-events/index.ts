/**
 * The inbound half: Roofr -> Zapier -> here.
 *
 * This is the only server surface in Delta Ridge, and it exists because the
 * alternative — letting the phone talk to Zapier directly — would mean shipping
 * a credential that creates CRM records to every device in the field.
 *
 * Three things this endpoint refuses to do, each of which is a real failure
 * mode of webhook integrations rather than a hypothetical one:
 *
 *   1. It never trusts an organisation id from the request. The bearer token IS
 *      the organisation, looked up by hash, so a leaked URL is inert and there
 *      is no id in the path for somebody to increment.
 *
 *   2. It never processes the same event twice. Zapier retries, and a person
 *      can replay a Zap by hand; without the unique key on provider_event_id,
 *      one signed proposal becomes three entries on a rep's timeline and three
 *      in the manager's numbers.
 *
 *   3. It never guesses which lead an event belongs to. A match is made on an
 *      id we issued, an id Roofr already gave us, or an address that resolves
 *      to exactly one property. Anything else is stored unlinked and shown in
 *      the sync log as needing a person, because an event filed against the
 *      wrong homeowner is worse than one filed against nobody.
 *
 * Nothing here logs a token, a payload, or a homeowner's details.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { describeEvent, linkPatchFor, normalizeEvent, type NormalizedEvent } from './events.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** Hex SHA-256, matching what the browser stores when the token is generated. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Which header carries the credential, and why the order matters.
 *
 * Supabase's function gateway verifies a JWT on `Authorization` before the
 * request reaches this code, so in production that header is already spoken
 * for: the Zap puts the publishable anon key there purely to satisfy the
 * gateway. Reading `Authorization` first therefore picks up the anon key, never
 * finds a matching organisation, and rejects every legitimate delivery with
 * "unrecognised credential" — which is exactly what happened the first time
 * this was pointed at the live endpoint.
 *
 * The custom header wins. `Authorization` stays as a fallback for a deployment
 * with the gateway check off, where it is the natural place to put it.
 */
function bearerFrom(req: Request): string | null {
  const custom = req.headers.get('x-delta-ridge-token')
  if (custom !== null && custom.trim() !== '') return custom.trim()

  const auth = req.headers.get('authorization')
  if (auth !== null) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim())
    if (match?.[1] !== undefined) return match[1].trim()
  }
  return null
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface Org {
  readonly organization_id: string
}

/**
 * Find the lead this event is about, and say how confident that is.
 *
 * `confident` is false only when nothing matched. There is no partial match:
 * the address path requires the normalised address to resolve to exactly one
 * property and that property to have exactly one obvious lead, so a duplex or a
 * repeated street number produces no link rather than a coin flip.
 */
async function resolveLead(
  db: SupabaseClient,
  org: string,
  event: NormalizedEvent,
): Promise<{ leadId: string | null; how: string }> {
  if (event.externalJobId !== null) {
    const { data } = await db
      .from('roofr_links')
      .select('lead_id')
      .eq('organization_id', org)
      .eq('external_job_id', event.externalJobId)
      .maybeSingle()
    if (data?.lead_id) return { leadId: data.lead_id as string, how: 'external_job_id' }
  }

  if (event.roofrJobId !== null) {
    const { data } = await db
      .from('roofr_links')
      .select('lead_id')
      .eq('organization_id', org)
      .eq('roofr_job_id', event.roofrJobId)
      .maybeSingle()
    if (data?.lead_id) return { leadId: data.lead_id as string, how: 'roofr_job_id' }
  }

  if (event.addressLine1 !== null) {
    // Composed exactly as the generated column is, or it will never match.
    const { data: normalized } = await db.rpc('roofr_normalize_address', {
      raw_address: event.addressLine1,
      raw_postal: event.postalCode,
    })
    if (typeof normalized === 'string' && normalized !== '') {
      const { data: properties } = await db
        .from('properties')
        .select('id')
        .eq('organization_id', org)
        .eq('normalized_address', normalized)
        .is('deleted_at', null)
        .limit(2)
      if (properties?.length === 1 && properties[0] !== undefined) {
        const propertyId = properties[0].id as string
        const { data: leads } = await db
          .from('leads')
          .select('id, status')
          .eq('organization_id', org)
          .eq('property_id', propertyId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(3)
        const open = (leads ?? []).filter(
          (l) => !['sold', 'lost', 'not_interested'].includes(l.status as string),
        )
        if (open.length === 1 && open[0] !== undefined) {
          return { leadId: open[0].id as string, how: 'address' }
        }
        if (open.length === 0 && leads?.length === 1 && leads[0] !== undefined) {
          return { leadId: leads[0].id as string, how: 'address_closed_lead' }
        }
      }
    }
  }

  return { leadId: null, how: 'unmatched' }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (SUPABASE_URL === '' || SERVICE_ROLE_KEY === '') {
    console.error('roofr-events: function secrets are not configured')
    return json({ error: 'not configured' }, 500)
  }

  const token = bearerFrom(req)
  if (token === null) return json({ error: 'missing credential' }, 401)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const hash = await sha256Hex(token)
  const { data: settings, error: lookupError } = await db
    .from('roofr_settings')
    .select('organization_id')
    .eq('webhook_secret_hash', hash)
    .maybeSingle<Org>()

  if (lookupError !== null) {
    console.error('roofr-events: credential lookup failed', lookupError.message)
    return json({ error: 'temporarily unavailable' }, 503)
  }
  // Deliberately the same answer as a malformed token, and with no hint about
  // which part was wrong.
  if (settings === null) return json({ error: 'unrecognised credential' }, 401)
  const org = settings.organization_id

  const raw = await req.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return json({ error: 'body was not JSON' }, 400)
  }

  const payloadHash = await sha256Hex(raw)
  const normalized = normalizeEvent(parsed)

  if (!normalized.ok) {
    /*
     * Recorded, not dropped.
     *
     * A misconfigured Zap that silently 400s is invisible until somebody
     * notices a month of missing proposals. This row is what makes it visible
     * on the Roofr settings screen the same day.
     */
    await db.from('roofr_events').insert({
      organization_id: org,
      provider_event_id: `malformed:${payloadHash}`,
      event_type: 'lead_created',
      status: 'failed',
      payload_hash: payloadHash,
      error: normalized.reason,
      processed_at: new Date().toISOString(),
    })
    return json({ error: normalized.reason }, 400)
  }

  const event = normalized.event

  // The unique index on (organization_id, provider_event_id) is what makes a
  // redelivery harmless. The insert is the check; there is no read-then-write
  // race to lose.
  const { data: inserted, error: insertError } = await db
    .from('roofr_events')
    .insert({
      organization_id: org,
      provider_event_id: event.providerEventId,
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      roofr_job_id: event.roofrJobId,
      roofr_customer_id: event.roofrCustomerId,
      payload_hash: payloadHash,
      status: 'received',
    })
    .select('id')
    .maybeSingle()

  if (insertError !== null) {
    if (insertError.code === '23505') {
      return json({ ok: true, duplicate: true, event_id: event.providerEventId }, 200)
    }
    console.error('roofr-events: could not record event', insertError.message)
    // 5xx so Zapier retries; the event has not been recorded and losing it
    // would be a silent hole in the history.
    return json({ error: 'could not record event' }, 503)
  }

  const eventRowId = inserted?.id as string | undefined
  const { leadId, how } = await resolveLead(db, org, event)
  const at = event.occurredAt ?? new Date().toISOString()

  if (leadId !== null) {
    const patch = linkPatchFor(event)
    const { data: existing } = await db
      .from('roofr_links')
      .select('id')
      .eq('lead_id', leadId)
      .maybeSingle()

    if (existing?.id) {
      await db.from('roofr_links').update(patch).eq('id', existing.id)
    } else {
      await db.from('roofr_links').insert({
        organization_id: org,
        lead_id: leadId,
        external_job_id: event.externalJobId,
        ...patch,
      })
    }

    // The lead's own timeline. activity_type is 'roofr_event' so nothing
    // downstream mistakes a CRM notification for a rep's door knock: Roofr
    // activity must never count toward a rep's canvassing numbers or grade.
    await db.from('activities').insert({
      organization_id: org,
      lead_id: leadId,
      activity_type: 'roofr_event',
      outcome: event.eventType,
      body: describeEvent(event),
      occurred_at: at,
      metadata: {
        source: 'roofr',
        event_type: event.eventType,
        roofr_job_id: event.roofrJobId,
        matched_by: how,
      },
    })
  }

  // An outbound create being confirmed: this, and only this, is what makes an
  // outbox row acknowledged. "Zapier accepted our POST" is not "Roofr made the
  // job", and treating the first as the second is how a job goes missing with
  // every screen showing green.
  if (event.eventType === 'job_created' && event.externalJobId !== null) {
    await db
      .from('roofr_outbox')
      .update({ status: 'acknowledged', acknowledged_at: at })
      .eq('organization_id', org)
      .eq('external_job_id', event.externalJobId)
      .in('status', ['queued', 'sent'])
  }

  if (eventRowId !== undefined) {
    await db
      .from('roofr_events')
      .update({
        status: leadId === null ? 'ignored' : 'processed',
        processed_at: new Date().toISOString(),
        lead_id: leadId,
        error: leadId === null ? `no confident lead match (${how})` : null,
      })
      .eq('id', eventRowId)
  }

  await db
    .from('roofr_settings')
    .update({ last_inbound_at: new Date().toISOString() })
    .eq('organization_id', org)

  // One line per delivery, with no payload, no token and no homeowner in it.
  // Enough to correlate a Zapier run with a row here when a Zap misbehaves.
  // eslint-disable-next-line no-console
  console.log(`roofr-events: ${event.eventType} matched=${how}`)
  return json({ ok: true, matched: how, linked: leadId !== null }, 200)
})
