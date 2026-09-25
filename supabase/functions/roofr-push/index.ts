/**
 * The outbound half: a qualified Delta Ridge lead -> Zapier -> Roofr.
 *
 * Gated, on purpose. Roofr's own help page still describes the Zapier
 * integration as one-way (Roofr to elsewhere), while Zapier's directory lists a
 * "Create Job and Customer" action. Both cannot be current. Until a real Zap has
 * been seen to create a real job on this account, `roofr_settings.push_enabled`
 * stays false and this endpoint refuses everything — which is the difference
 * between an integration that is off and one that silently does nothing.
 *
 * Three properties worth stating plainly:
 *
 *   - The Zapier hook URL is a credential. Anyone holding it can create records
 *     in the company's CRM, so it lives in Edge Function secrets and never
 *     reaches a phone. This function exists largely so that it doesn't.
 *
 *   - A POST that times out is recorded as `sent`, never as failed. We do not
 *     know whether Zapier received it, and retrying on that unknown is how one
 *     lead becomes two jobs. The external id makes a retry safe; the operator
 *     decides when to make one.
 *
 *   - Nothing here marks a row acknowledged. Only Roofr saying so, through the
 *     inbound webhook, does that.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  buildJobPayload,
  eligibility,
  externalJobId,
  type PushCandidate,
  type PushThreshold,
} from './payload.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const HOOK_URL = Deno.env.get('ZAPIER_ROOFR_HOOK_URL') ?? ''

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } })
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
  if (SUPABASE_URL === '' || SERVICE_ROLE_KEY === '' || ANON_KEY === '') {
    return json({ error: 'not configured' }, 500)
  }

  const authorization = req.headers.get('authorization')
  if (authorization === null) return json({ error: 'sign in first' }, 401)

  /*
   * Two clients, deliberately.
   *
   * `asCaller` carries the user's own JWT, so every read below is filtered by
   * the same row level security the app runs under: a rep cannot push a lead
   * they could not open. `db` holds the service role and is used only to write
   * rows the client is not allowed to write directly, such as marking an outbox
   * row sent. Using the service role for the reads as well would mean a lead id
   * from another organisation, typed into a curl command, would work.
   */
  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: auth } = await asCaller.auth.getUser()
  const user = auth?.user
  if (!user) return json({ error: 'sign in first' }, 401)

  let body: { lead_id?: unknown }
  try {
    body = (await req.json()) as { lead_id?: unknown }
  } catch {
    return json({ error: 'body was not JSON' }, 400)
  }
  const leadId = typeof body.lead_id === 'string' ? body.lead_id : null
  if (leadId === null) return json({ error: 'lead_id is required' }, 400)

  const { data: lead, error: leadError } = await asCaller
    .from('leads')
    .select(
      'id, status, organization_id, assigned_to, ' +
        'customers ( first_name, last_name, company_name, email, primary_phone, phone_source ), ' +
        'properties ( address_line1, city, state, postal_code )',
    )
    .eq('id', leadId)
    .is('deleted_at', null)
    .maybeSingle()

  // Not found and not permitted are the same answer on purpose: a lead id is a
  // guessable thing and the response should not confirm one exists.
  if (leadError !== null || lead === null) return json({ error: 'lead not found' }, 404)

  const org = lead.organization_id as string

  const { data: settings } = await asCaller
    .from('roofr_settings')
    .select('push_enabled, push_threshold')
    .eq('organization_id', org)
    .maybeSingle()

  const threshold = (settings?.push_threshold as PushThreshold | undefined) ?? 'inspection_scheduled'

  // Server-enforced, not a hidden button: when the company's rule is that a
  // manager decides, a rep's request is refused here even if the UI let them ask.
  if (threshold === 'manager_approved') {
    const { data: membership } = await asCaller
      .from('organization_members')
      .select('role')
      .eq('organization_id', org)
      .eq('user_id', user.id)
      .maybeSingle()
    const role = membership?.role as string | undefined
    if (role !== 'admin' && role !== 'manager') {
      return json({ error: 'a manager has to approve a lead before it goes to Roofr' }, 403)
    }
  }

  const { data: existingLink } = await asCaller
    .from('roofr_links')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle()

  const customer = (lead.customers ?? null) as Record<string, unknown> | null
  const property = (lead.properties ?? null) as Record<string, unknown> | null

  const candidate: PushCandidate = {
    leadId,
    status: lead.status as string,
    firstName: (customer?.['first_name'] as string | null) ?? null,
    lastName: (customer?.['last_name'] as string | null) ?? null,
    companyName: (customer?.['company_name'] as string | null) ?? null,
    email: (customer?.['email'] as string | null) ?? null,
    phone: (customer?.['primary_phone'] as string | null) ?? null,
    phoneSource: (customer?.['phone_source'] as string | null) ?? null,
    addressLine1: (property?.['address_line1'] as string | null) ?? null,
    city: (property?.['city'] as string | null) ?? null,
    state: (property?.['state'] as string | null) ?? null,
    postalCode: (property?.['postal_code'] as string | null) ?? null,
    alreadyLinked: existingLink !== null,
  }

  const verdict = eligibility(candidate, {
    pushEnabled: settings?.push_enabled === true,
    threshold,
  })
  if (!verdict.ok) return json({ error: verdict.reason }, 409)

  const payload = buildJobPayload(candidate)
  const external = externalJobId(leadId)

  // The partial unique index on (lead_id) where status in ('queued','sent') is
  // what actually prevents a double send; this insert is how we consult it.
  const { data: queued, error: queueError } = await db
    .from('roofr_outbox')
    .insert({
      organization_id: org,
      lead_id: leadId,
      action: 'create_job_and_customer',
      payload,
      external_job_id: external,
      status: 'queued',
      queued_by: user.id,
    })
    .select('id')
    .maybeSingle()

  if (queueError !== null) {
    if (queueError.code === '23505') {
      return json({ error: 'this lead is already on its way to Roofr' }, 409)
    }
    return json({ error: 'could not queue this lead' }, 503)
  }
  const outboxId = queued?.id as string | undefined

  if (HOOK_URL === '') {
    await db
      .from('roofr_outbox')
      .update({ status: 'failed', last_error: 'no Zapier hook URL configured', attempts: 1 })
      .eq('id', outboxId ?? '')
    return json({ error: 'the Zapier hook is not configured yet' }, 503)
  }

  let sent = false
  let failure: string | null = null
  try {
    const response = await fetch(HOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    })
    sent = response.ok
    if (!response.ok) failure = `Zapier answered ${response.status}`
  } catch (error) {
    /*
     * A timeout is not a failure, it is an unknown.
     *
     * Marking it failed invites a retry, and a retry of a POST that may have
     * already reached Zapier is how one lead becomes two jobs in the CRM. The
     * row stays `sent` with the reason recorded; if Roofr never acknowledges
     * it, the sync log shows a send with no acknowledgement and a person
     * decides.
     */
    const message = error instanceof Error ? error.message : 'unknown transport error'
    const unknown = /timeout|abort/i.test(message)
    sent = unknown
    failure = unknown ? `no answer from Zapier within 10s: ${message}` : message
  }

  await db
    .from('roofr_outbox')
    .update({
      status: sent ? 'sent' : 'failed',
      sent_at: sent ? new Date().toISOString() : null,
      attempts: 1,
      last_error: failure,
    })
    .eq('id', outboxId ?? '')

  if (sent) {
    await db
      .from('roofr_settings')
      .update({ last_outbound_at: new Date().toISOString() })
      .eq('organization_id', org)
  }

  return json(
    {
      ok: sent,
      // Said plainly, because "sent" is not "created".
      state: sent ? 'sent to Zapier, waiting for Roofr to confirm' : 'not sent',
      external_job_id: external,
      error: sent ? null : failure,
    },
    sent ? 202 : 502,
  )
})
