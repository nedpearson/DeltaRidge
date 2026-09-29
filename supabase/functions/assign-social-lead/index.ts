import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3"
import { requireOrgMember } from "../_shared/auth.ts"

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name' } })
  }

  try {
    const { conversation_id, property_address, first_name, last_name, phone } = await req.json()
    if (!conversation_id || !property_address) {
      return new Response(JSON.stringify({ error: "Missing conversation_id or property_address" }), { status: 400 })
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 1. Get conversation
    const { data: conv } = await supabaseClient.from('social_conversations').select(`
      *,
      profile:social_profiles(*)
    `).eq('id', conversation_id).single()
    
    if (!conv) throw new Error('Conversation not found')

    await requireOrgMember(req, conv.organization_id)

    // 2. Resolve Property
    const { data: property } = await supabaseClient.rpc('resolve_property_from_address', {
      org_id: conv.organization_id,
      address_query: property_address
    })
    
    let propertyId = property?.[0]?.id
    if (!propertyId) {
      const { data: newProp, error: insertPropError } = await supabaseClient.from('properties').insert({
        organization_id: conv.organization_id,
        raw_address: property_address,
        normalized_address: property_address.toUpperCase()
      }).select('id').single()
      if (insertPropError) throw insertPropError;
      propertyId = newProp?.id
    }

    if (!propertyId) throw new Error("Failed to resolve property")

    // 3. Create or Match customer
    let customerId = conv.profile?.customer_id;
    if (!customerId) {
      const { data: customer, error: custError } = await supabaseClient.from('customers').insert({
        organization_id: conv.organization_id,
        first_name: first_name || conv.profile?.display_name?.split(' ')[0] || 'Unknown',
        last_name: last_name || conv.profile?.display_name?.split(' ').slice(1).join(' ') || 'User',
        phone: phone || null,
      }).select().single()
      if (custError) throw custError;
      customerId = customer.id;
      if (conv.social_profile_id) {
         await supabaseClient.from('social_profiles').update({ customer_id: customerId }).eq('id', conv.social_profile_id);
      }
    }

    // 4. Create lead
    const { data: lead, error: leadError } = await supabaseClient.from('leads').insert({
      organization_id: conv.organization_id,
      property_id: propertyId,
      customer_id: customerId,
      status: 'target',
    }).select().single()
    if (leadError) throw leadError;

    // 5. Update conversation
    await supabaseClient.from('social_conversations').update({ lead_id: lead.id }).eq('id', conversation_id)

    return new Response(JSON.stringify(lead), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    })
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: (error instanceof Error ? error.message : String(error)) }), { status: 400 })
  }
})
