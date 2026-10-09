import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function inboundToken(req: Request): string | null {
  const direct = req.headers.get('x-delta-ridge-token')?.trim()
  if (direct) return direct
  const auth = req.headers.get('authorization')?.trim()
  if (!auth?.toLowerCase().startsWith('bearer ')) return null
  return auth.slice(7).trim() || null
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server is not configured.' }, 503)

  const token = inboundToken(req)
  if (!token) return json({ error: 'Missing inbound webhook credential.' }, 401)

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  try {
    const tokenHash = await sha256Hex(token)
    const { data: settings, error: authError } = await db
      .from('inbound_lead_webhook_settings')
      .select('organization_id')
      .eq('secret_hash', tokenHash)
      .maybeSingle()

    if (authError) throw authError
    if (!settings?.organization_id) return json({ error: 'Invalid inbound webhook credential.' }, 401)

    const orgId = settings.organization_id as string
    const payload = await req.json() as Record<string, unknown>

    const fullName = typeof payload.name === 'string' ? payload.name.trim() : ''
    const firstName =
      (typeof payload.first_name === 'string' && payload.first_name.trim()) ||
      (typeof payload.firstName === 'string' && payload.firstName.trim()) ||
      fullName.split(/\s+/)[0] ||
      null
    const lastName =
      (typeof payload.last_name === 'string' && payload.last_name.trim()) ||
      (typeof payload.lastName === 'string' && payload.lastName.trim()) ||
      fullName.split(/\s+/).slice(1).join(' ') ||
      null
    const phone =
      (typeof payload.phone === 'string' && payload.phone.trim()) ||
      (typeof payload.phone_number === 'string' && payload.phone_number.trim()) ||
      null
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() || null : null
    const address =
      (typeof payload.address === 'string' && payload.address.trim()) ||
      (typeof payload.street === 'string' && payload.street.trim()) ||
      (typeof payload.property_address === 'string' && payload.property_address.trim()) ||
      ''
    const sourceName =
      (typeof payload.source === 'string' && payload.source.trim()) ||
      (typeof payload.utm_source === 'string' && payload.utm_source.trim()) ||
      'Inbound Webhook'

    if (!address) return json({ error: 'address is required' }, 400)

    const { data: resolved, error: resolveError } = await db.rpc('resolve_property_from_address', {
      org_id: orgId,
      address_query: address,
    })
    if (resolveError) throw resolveError

    let propertyId = resolved?.[0]?.id as string | undefined
    if (!propertyId) {
      const { data: property, error } = await db
        .from('properties')
        .insert({
          organization_id: orgId,
          address_line1: address,
        })
        .select('id')
        .single()
      if (error) throw error
      propertyId = property.id as string
    }

    let customerId: string | null = null
    const phoneDigits = phone?.replace(/\D/g, '') || null

    if (phoneDigits) {
      const { data, error } = await db
        .from('customers')
        .select('id')
        .eq('organization_id', orgId)
        .eq('phone_digits', phoneDigits)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      customerId = (data?.id as string | undefined) ?? null
    }

    if (!customerId && email) {
      const { data, error } = await db
        .from('customers')
        .select('id')
        .eq('organization_id', orgId)
        .eq('email_lower', email)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle()
      if (error) throw error
      customerId = (data?.id as string | undefined) ?? null
    }

    if (!customerId) {
      const { data: existingOwner, error: ownerError } = await db
        .from('property_owners')
        .select('customer_id')
        .eq('property_id', propertyId)
        .eq('is_current', true)
        .limit(1)
        .maybeSingle()
      if (ownerError) throw ownerError
      customerId = (existingOwner?.customer_id as string | undefined) ?? null
    }

    if (!customerId) {
      const { data: customer, error } = await db
        .from('customers')
        .insert({
          organization_id: orgId,
          first_name: firstName,
          last_name: lastName,
          primary_phone: phone,
          email,
          notes: `Inbound lead from ${sourceName}`,
        })
        .select('id')
        .single()
      if (error) throw error
      customerId = customer.id as string
    }

    const { data: ownerLink, error: ownerLinkError } = await db
      .from('property_owners')
      .select('id')
      .eq('property_id', propertyId)
      .eq('customer_id', customerId)
      .maybeSingle()
    if (ownerLinkError) throw ownerLinkError
    if (!ownerLink) {
      const { error } = await db.from('property_owners').insert({
        property_id: propertyId,
        customer_id: customerId,
      })
      if (error) throw error
    }

    let leadSourceId: string | null = null
    const { data: existingSource, error: sourceReadError } = await db
      .from('lead_sources')
      .select('id')
      .eq('organization_id', orgId)
      .eq('name', sourceName)
      .maybeSingle()
    if (sourceReadError) throw sourceReadError

    if (existingSource) {
      leadSourceId = existingSource.id as string
    } else {
      const { data: source, error } = await db
        .from('lead_sources')
        .insert({ organization_id: orgId, name: sourceName, category: 'web' })
        .select('id')
        .single()
      if (error) throw error
      leadSourceId = source.id as string
    }

    const { data: existingLead, error: leadReadError } = await db
      .from('leads')
      .select('id')
      .eq('organization_id', orgId)
      .eq('property_id', propertyId)
      .is('deleted_at', null)
      .not('status', 'in', '(sold,lost,not_interested)')
      .limit(1)
      .maybeSingle()
    if (leadReadError) throw leadReadError

    let leadId = existingLead?.id as string | undefined
    if (!leadId) {
      const { data: lead, error } = await db
        .from('leads')
        .insert({
          organization_id: orgId,
          property_id: propertyId,
          customer_id: customerId,
          status: 'untouched',
          lead_source_id: leadSourceId,
        })
        .select('id')
        .single()
      if (error) throw error
      leadId = lead.id as string
    }

    await db
      .from('inbound_lead_webhook_settings')
      .update({ last_used_at: new Date().toISOString() })
      .eq('organization_id', orgId)

    return json({ success: true, lead_id: leadId })
  } catch (error: unknown) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
