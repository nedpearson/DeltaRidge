import { createClient } from 'npm:@supabase/supabase-js@2'


const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const BATCHDATA_API_KEY = Deno.env.get('BATCHDATA_API_KEY') ?? ''

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export interface PropertyDetails {
  beds: number | null
  baths: number | null
  sqft: number | null
  lotSize: number | null
  stories: number | null
  yearBuilt: number | null
  roofMaterial: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (SUPABASE_URL === '' || ANON_KEY === '') {
      return new Response(JSON.stringify({ error: 'Server authentication is not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const authorization = req.headers.get('authorization')
    if (!authorization) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: auth, error: authError } = await caller.auth.getUser()
    if (authError || !auth?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { data: membership } = await caller
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', auth.user.id)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()

    if (!membership?.organization_id) {
      return new Response(JSON.stringify({ error: 'No active organization membership' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { street, city, state } = await req.json()

    if (!street || !city || !state) {
      return new Response(JSON.stringify({ error: 'Missing address fields' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!BATCHDATA_API_KEY) {
      console.warn('No BATCHDATA_API_KEY provided')
      return new Response(JSON.stringify({ success: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const res = await fetch('https://api.batchdata.com/api/v1/property/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BATCHDATA_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        searchCriteria: {
          'address.street': { equals: street },
          'address.city': { equals: city },
          'address.state': { equals: state },
        },
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      const txt = await res.text()
      console.error('BatchData API Error', res.status, txt)
      return new Response(JSON.stringify({ success: false, error: 'BatchData API failed' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await res.json()
    const prop = data?.results?.properties?.[0]
    
    if (!prop) {
      return new Response(JSON.stringify({ success: false, error: 'No property found' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const attrs = prop.characteristics || prop.property || prop.attributes || prop

    const details: PropertyDetails = {
      beds: attrs.beds ?? attrs.bedrooms ?? null,
      baths: attrs.baths ?? attrs.bathrooms ?? attrs.bathroomsTotal ?? null,
      sqft: attrs.sqft ?? attrs.livingArea ?? attrs.buildingAreaSqFt ?? attrs.totalAreaSqFt ?? null,
      lotSize: attrs.lotSize ?? attrs.lotAreaSqFt ?? attrs.lotSizeAcres ?? attrs.lotSizeArea ?? null,
      stories: attrs.stories ?? attrs.storyCount ?? attrs.levels ?? null,
      yearBuilt: attrs.yearBuilt ?? attrs.buildYear ?? null,
      roofMaterial: attrs.roofMaterial ?? attrs.roofCover ?? attrs.roofType ?? null,
    }

    // We also return the raw property to see the exact shape in logs if needed.
    return new Response(JSON.stringify({ success: true, details, raw: prop }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
