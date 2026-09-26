import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// This function orchestrates automated direct mail campaigns using the Lob.com API.
// It can be triggered by a database webhook (e.g., when a storm event is inserted,
// or when a lead status changes to 'won').

const LOB_API_KEY = Deno.env.get('LOB_API_KEY') // e.g. [REDACTED_API_KEY]
const LOB_API_URL = 'https://api.lob.com/v1/postcards'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Authorize the request (must come from authenticated internal service)
  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  
  if (!serviceKey || authHeader !== \Bearer \\) {
    return new Response('Unauthorized', { status: 401 })
  }

  try {
    const payload = await req.json()
    const { campaign_type, addresses, storm_date, hail_size } = payload

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return new Response(JSON.stringify({ error: 'No addresses provided' }), { status: 400 })
    }

    if (!LOB_API_KEY) {
      // If Lob isn't configured, we log the intent but don't fail, 
      // acting as a dry-run in staging.
      console.log(\[DRY RUN] Would send \ postcards for \\)
      return new Response(JSON.stringify({ 
        success: true, 
        message: \Dry run completed. Sent \ mock postcards.\ 
      }))
    }

    // Determine the creative/HTML template to use
    let frontTemplate = ''
    let backTemplate = ''

    if (campaign_type === 'post_storm') {
      frontTemplate = \	mpl_post_storm_front_v1\
      backTemplate = \	mpl_post_storm_back_v1\
    } else if (campaign_type === 'neighborhood_blast') {
      frontTemplate = \	mpl_just_installed_front_v1\
      backTemplate = \	mpl_just_installed_back_v1\
    } else {
      throw new Error('Invalid campaign_type')
    }

    // Construct the Lob API payload
    // Lob allows sending bulk postcards up to a certain limit per API call
    const lobPayload = {
      description: \Delta Ridge Automated Campaign: \\,
      to: addresses.map(addr => ({
        name: addr.name || 'Current Resident',
        address_line1: addr.address_line1,
        address_city: addr.city,
        address_state: addr.state,
        address_zip: addr.zip,
      })),
      from: {
        company: 'Delta Ridge Roofing',
        address_line1: '123 Main St',
        address_city: 'Austin',
        address_state: 'TX',
        address_zip: '78701'
      },
      front: frontTemplate,
      back: backTemplate,
      merge_variables: {
        storm_date: storm_date || '',
        hail_size: hail_size || ''
      }
    }

    const authString = btoa(\\:\)
    const res = await fetch(LOB_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': \Basic \\,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(lobPayload)
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(\Lob API Error: \\)
    }

    const result = await res.json()

    // Log the successful campaign in Supabase (Integration Health)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(supabaseUrl, serviceKey)
    await supabase.from('integration_health_logs').insert({
      integration_name: 'lob_direct_mail',
      status: 'success',
      message: \Dispatched \ postcards for \ campaign.\
    })

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Postcards queued for printing and delivery',
      lob_id: result.id
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(supabaseUrl, serviceKey!)
    await supabase.from('integration_health_logs').insert({
      integration_name: 'lob_direct_mail',
      status: 'failed',
      message: error.message
    })

    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

