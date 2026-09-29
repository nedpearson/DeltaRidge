import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { requireOrgMember } from "../_shared/auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
      },
    })
  }
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  try {
    const { conversation_id, property_address, first_name, last_name, phone } = await req.json()
    if (!conversation_id || typeof property_address !== 'string' || !property_address.trim()) {
      return new Response(JSON.stringify({ error: 'Missing conversation_id or property_address' }), { status: 400 })
    }

    const db = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: conv, error: convError } = await db
      .from('social_conversations')
      .select('id, organization_id, social_profile_id, lead_id, profile:social_profiles(customer_id, display_name)')
      .eq('id', conversation_id)
      .single()

    if (convError || !conv) throw convError || new Error('Conversation not found')
    await requireOrgMember(req, conv.organization_id)

    if (conv.lead_id) {
      const { data: existingLead, error } = await db.from('leads').select('*').eq('id', conv.lead_id).single()
      if (error) throw error
      return new Response(JSON.stringify(existingLead), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      })
    }

    const cleanAddress = property_address.trim()
    const { data: resolved, error: resolveError } = await db.rpc('resolve_property_from_address', {
      org_id: conv.organization_id,
      address_query: cleanAddress,
    })
    if (resolveError) throw resolveError

    let propertyId = resolved?.[0]?.id as string | undefined
    if (!propertyId) {
      const { data: property, error } = await db
        .from('properties')
        .insert({
          organization_id: conv.organization_id,
          address_line1: cleanAddress,
          provenance: 'social-conversation',
        })
        .select('id')
        .single()
      if (error) throw error
      propertyId = property.id as string
    }

    let customerId = conv.profile?.customer_id as string | null
    if (!customerId) {
      const displayName = typeof conv.profile?.display_name === 'string' ? conv.profile.display_name.trim() : ''
      const { data: customer, error } = await db
        .from('customers')
        .insert({
          organization_id: conv.organization_id,
          first_name: first_name || displayName.split(/\s+/)[0] || null,
          last_name: last_name || displayName.split(/\s+/).slice(1).join(' ') || null,
          primary_phone: phone || null,
        })
        .select('id')
        .single()
      if (error) throw error
      customerId = customer.id as string

      if (conv.social_profile_id) {
        const { error: profileError } = await db
          .from('social_profiles')
          .update({ customer_id: customerId })
          .eq('id', conv.social_profile_id)
        if (profileError) throw profileError
      }
    }

    if (customerId) {
      const { data: owner } = await db
        .from('property_owners')
        .select('id')
        .eq('property_id', propertyId)
        .eq('customer_id', customerId)
        .maybeSingle()
      if (!owner) {
        const { error } = await db.from('property_owners').insert({
          property_id: propertyId,
          customer_id: customerId,
        })
        if (error) throw error
      }
    }

    const { data: openLead, error: openLeadError } = await db
      .from('leads')
      .select('*')
      .eq('organization_id', conv.organization_id)
      .eq('property_id', propertyId)
      .is('deleted_at', null)
      .not('status', 'in', '(sold,lost,not_interested)')
      .limit(1)
      .maybeSingle()
    if (openLeadError) throw openLeadError

    let lead = openLead
    if (!lead) {
      const created = await db
        .from('leads')
        .insert({
          organization_id: conv.organization_id,
          property_id: propertyId,
          customer_id: customerId,
          status: 'target',
        })
        .select('*')
        .single()
      if (created.error) throw created.error
      lead = created.data
    }

    const { error: updateError } = await db
      .from('social_conversations')
      .update({ lead_id: lead.id })
      .eq('id', conversation_id)
    if (updateError) throw updateError

    return new Response(JSON.stringify(lead), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
