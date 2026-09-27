 
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const LOB_API_KEY = Deno.env.get('LOB_API_KEY')
const LOB_API_URL = 'https://api.lob.com/v1/postcards'

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!serviceKey || authHeader !== 'Bearer ' + serviceKey) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Sender identity must come from organization config, not hardcoded values.
  // Read from org settings or environment variables.
  const senderCompany = Deno.env.get('ORG_COMPANY_NAME')
  const senderAddress = Deno.env.get('ORG_ADDRESS_LINE1')
  const senderCity = Deno.env.get('ORG_ADDRESS_CITY')
  const senderState = Deno.env.get('ORG_ADDRESS_STATE')
  const senderZip = Deno.env.get('ORG_ADDRESS_ZIP')

  try {
    const payload = await req.json()
    const { campaign_type, addresses, storm_date, hail_size } = payload

    if (!addresses || !Array.isArray(addresses) || addresses.length === 0) {
      return new Response(JSON.stringify({ error: 'No addresses provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // ---------------------------------------------------------------
    // DRY RUN: LOB_API_KEY is not configured.
    // Return status: 'DRY_RUN', success: false.
    // The caller MUST NOT treat this as a real dispatch.
    // ---------------------------------------------------------------
    if (!LOB_API_KEY) {
      console.warn('[DRY_RUN] LOB_API_KEY not set. No postcards were sent.')
      return new Response(JSON.stringify({
        status: 'DRY_RUN',
        success: false,
        dispatched: 0,
        message: 'LOB_API_KEY is not configured. No postcards were sent. This is a simulation only.'
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ---------------------------------------------------------------
    // Validate sender identity is configured
    // ---------------------------------------------------------------
    if (!senderCompany || !senderAddress || !senderCity || !senderState || !senderZip) {
      console.warn('[BLOCKED] Sender address not fully configured in environment.')
      return new Response(JSON.stringify({
        status: 'BLOCKED',
        success: false,
        dispatched: 0,
        message: 'Sender identity (ORG_COMPANY_NAME, ORG_ADDRESS_*) is not fully configured. Cannot send mail.'
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    }

    // ---------------------------------------------------------------
    // Resolve templates by campaign type
    // ---------------------------------------------------------------
    const templateFrontId = Deno.env.get('LOB_TEMPLATE_FRONT_' + campaign_type.toUpperCase())
    const templateBackId = Deno.env.get('LOB_TEMPLATE_BACK_' + campaign_type.toUpperCase())

    if (!templateFrontId || !templateBackId) {
      return new Response(JSON.stringify({
        status: 'BLOCKED',
        success: false,
        dispatched: 0,
        message: 'Lob template IDs not configured for campaign type: ' + campaign_type
      }), { status: 422, headers: { 'Content-Type': 'application/json' } })
    }

    // ---------------------------------------------------------------
    // Build and send to Lob
    // ---------------------------------------------------------------
    const lobPayload = {
      description: senderCompany + ' Campaign: ' + campaign_type,
      to: addresses.map((addr: Record<string, string>) => ({
        name: addr.name || 'Current Resident',
        address_line1: addr.address_line1,
        address_city: addr.city,
        address_state: addr.state,
        address_zip: addr.zip,
      })),
      from: {
        company: senderCompany,
        address_line1: senderAddress,
        address_city: senderCity,
        address_state: senderState,
        address_zip: senderZip
      },
      front: templateFrontId,
      back: templateBackId,
      merge_variables: {
        storm_date: storm_date || '',
        hail_size: hail_size || ''
      }
    }

    const authString = btoa(LOB_API_KEY + ':')
    const res = await fetch(LOB_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + authString,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(lobPayload)
    })

    if (!res.ok) {
      const errorText = await res.text()
      throw new Error('Lob API rejected request: ' + errorText)
    }

    const result = await res.json()

    // Log verified success
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabase = createClient(supabaseUrl, serviceKey)
    await supabase.from('integration_health_logs').insert({
      integration_name: 'lob_direct_mail',
      status: 'success',
      message: 'Lob accepted ' + addresses.length + ' postcards. Lob ID: ' + result.id
    })

    return new Response(JSON.stringify({
      status: 'SUBMITTED_TO_LOB',
      success: true,
      dispatched: addresses.length,
      lob_id: result.id,
      message: 'Postcards accepted by Lob for printing and delivery.'
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    // Log verified failure
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    if (supabaseUrl && serviceKey) {
      const supabase = createClient(supabaseUrl, serviceKey)
      await supabase.from('integration_health_logs').insert({
        integration_name: 'lob_direct_mail',
        status: 'failed',
        message: (error as Error).message
      })
    }

    return new Response(JSON.stringify({
      status: 'FAILED',
      success: false,
      dispatched: 0,
      error: (error as Error).message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
