 
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  const webhookSecret = Deno.env.get('INBOUND_WEBHOOK_SECRET')
  
  if (webhookSecret && authHeader !== ('Bearer ' + webhookSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const payload = await req.json()
    
    const firstName = payload.first_name || payload.firstName || payload.name?.split(' ')[0] || 'Unknown'
    const lastName = payload.last_name || payload.lastName || payload.name?.split(' ').slice(1).join(' ') || ''
    const phone = payload.phone || payload.phone_number || null
    const email = payload.email || null
    const address = payload.address || payload.street || payload.property_address || ''
    const sourceName = payload.source || payload.utm_source || 'Digital Ad Campaign'
    const orgId = payload.org_id

    if (!orgId) {
      return new Response(JSON.stringify({ error: 'org_id is required' }), { status: 400 })
    }
    if (!address) {
      return new Response(JSON.stringify({ error: 'address is required' }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Resolve Property
    const { data: propData, error: propError } = await supabase.rpc('resolve_property_from_address', {
      org_id: orgId,
      address_query: address
    })
    
    let propertyId = propData?.[0]?.id
    if (!propertyId) {
      const { data: newProp, error: insertPropError } = await supabase.from('properties').insert({
        organization_id: orgId,
        raw_address: address,
        normalized_address: address.toUpperCase(),
        address_line1: address
      }).select('id').single()
      if (insertPropError) throw insertPropError
      propertyId = newProp?.id
    }

    if (!propertyId) throw new Error("Failed to resolve property")

    // 2. Identity matching (match by phone or email)
    let customerId = null
    if (phone || email) {
      let query = supabase.from('customers').select('id').eq('organization_id', orgId)
      if (phone && email) {
         query = query.or(`primary_phone.eq."${phone}",email.eq."${email}"`)
      } else if (phone) {
         query = query.eq('primary_phone', phone)
      } else {
         query = query.eq('email', email)
      }
      const { data: matchedCustomers } = await query.limit(1)
      if (matchedCustomers && matchedCustomers.length > 0) {
        customerId = matchedCustomers[0].id
      }
    }

    if (!customerId) {
      const { data: customer, error: customerErr } = await supabase
        .from('customers')
        .insert({
          organization_id: orgId,
          first_name: firstName,
          last_name: lastName,
          primary_phone: phone,
          email: email,
          notes: ('Inbound lead from ' + sourceName)
        })
        .select('id')
        .single()
      if (customerErr) throw customerErr
      customerId = customer.id
    }

    // 3. Link Customer to Property (if not exists)
    const { data: linkData } = await supabase.from('property_owners')
      .select('id').eq('property_id', propertyId).eq('customer_id', customerId).maybeSingle()
    if (!linkData) {
      await supabase.from('property_owners').insert({
        property_id: propertyId,
        customer_id: customerId
      })
    }

    // 4. Resolve Lead Source
    let leadSourceId = null
    const { data: sourceData } = await supabase.from('lead_sources').select('id').eq('organization_id', orgId).eq('name', sourceName).maybeSingle()
    if (sourceData) {
       leadSourceId = sourceData.id
    } else {
       const { data: newSource } = await supabase.from('lead_sources').insert({ organization_id: orgId, name: sourceName, category: 'web' }).select('id').single()
       if (newSource) leadSourceId = newSource.id
    }

    // 5. Create or Find existing Lead on this property
    const { data: existingLead } = await supabase.from('leads').select('id')
      .eq('organization_id', orgId).eq('property_id', propertyId).in('status', ['untouched', 'target', 'appointment']).maybeSingle()

    let leadId = existingLead?.id
    if (!leadId) {
      const { data: lead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          organization_id: orgId,
          property_id: propertyId,
          customer_id: customerId,
          status: 'untouched',
          lead_source_id: leadSourceId,
          opportunity_score: 90 
        })
        .select('id')
        .single()

      if (leadErr) throw leadErr
      leadId = lead.id
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Lead successfully ingested into Delta Ridge',
      lead_id: leadId 
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

