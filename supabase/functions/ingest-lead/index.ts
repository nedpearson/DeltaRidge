/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, no-console */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// This function acts as a universal webhook receiver for Meta Ads, Google Ads, or Zapier.
// It accepts lead data, creates a Customer, a Property, and a Lead record, 
// and drops it into the system for reps to work.

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Basic Webhook Authentication (Require a bearer token configured in secrets)
  const authHeader = req.headers.get('Authorization')
  const webhookSecret = Deno.env.get('INBOUND_WEBHOOK_SECRET')
  
  if (webhookSecret && authHeader !== ('Bearer ' + webhookSecret)) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const payload = await req.json()
    
    // Normalize incoming data (handles different webhook formats)
    const firstName = payload.first_name || payload.firstName || payload.name?.split(' ')[0] || 'Unknown'
    const lastName = payload.last_name || payload.lastName || payload.name?.split(' ').slice(1).join(' ') || ''
    const phone = payload.phone || payload.phone_number || null
    const email = payload.email || null
    const address = payload.address || payload.street || 'Unknown Address'
    const source = payload.source || payload.utm_source || 'Digital Ad Campaign'
    const orgId = payload.org_id || Deno.env.get('DEFAULT_ORG_ID')

    if (!orgId) {
      return new Response(JSON.stringify({ error: 'org_id is required' }), { status: 400 })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 1. Create the Customer
    const { data: customer, error: customerErr } = await supabase
      .from('customers')
      .insert({
        organization_id: orgId,
        first_name: firstName,
        last_name: lastName,
        primary_phone: phone,
        email: email,
        notes: ('Inbound lead from ' + source)
      })
      .select('id')
      .single()

    if (customerErr) throw customerErr

    // 2. Create the Property (or find existing, but keeping simple for webhook)
    const { data: property, error: propertyErr } = await supabase
      .from('properties')
      .insert({
        organization_id: orgId,
        address_line1: address,
        // We would ideally geocode this here, but for now we insert raw address
        // location: ...
      })
      .select('id')
      .single()

    if (propertyErr) throw propertyErr

    // 3. Link Customer to Property
    await supabase.from('property_owners').insert({
      property_id: property.id,
      customer_id: customer.id
    })

    // 4. Create the Lead
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .insert({
        organization_id: orgId,
        property_id: property.id,
        status: 'untouched',
        source: 'inbound_marketing',
        score: 90 // Inbound digital leads are intrinsically high value
      })
      .select('id')
      .single()

    if (leadErr) throw leadErr

    // 5. Optionally insert into a specialized attribution or campaign tracking table
    // ...

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Lead successfully ingested into Delta Ridge',
      lead_id: lead.id 
    }), { 
      headers: { 'Content-Type': 'application/json' } 
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

