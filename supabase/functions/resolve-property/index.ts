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
    const { address, organizationId } = await req.json()
    if (typeof address !== 'string' || !address.trim() || typeof organizationId !== 'string' || !organizationId) {
      return new Response(JSON.stringify({ error: 'Missing address or organizationId' }), { status: 400 })
    }

    await requireOrgMember(req, organizationId)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRole) {
      return new Response(JSON.stringify({ error: 'Server is not configured.' }), { status: 503 })
    }
    const db = createClient(supabaseUrl, serviceRole)
    const cleanAddress = address.trim()

    const { data: existing, error: resolveError } = await db.rpc('resolve_property_from_address', {
      org_id: organizationId,
      address_query: cleanAddress,
    })
    if (resolveError) throw resolveError

    if (existing?.length) {
      return new Response(JSON.stringify({
        success: true,
        propertyId: existing[0].id,
        created: false,
        geocoded: false,
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    const { data: property, error: insertError } = await db
      .from('properties')
      .insert({
        organization_id: organizationId,
        address_line1: cleanAddress,
        provenance: 'resolve-property',
        geocoder: null,
        geocode_timestamp: null,
        confidence: null,
      })
      .select('id')
      .single()

    if (insertError) throw insertError

    return new Response(JSON.stringify({
      success: true,
      propertyId: property.id,
      created: true,
      geocoded: false,
    }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (error: unknown) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
