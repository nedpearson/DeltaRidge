 
/**
 * Resident Contact & Phone Enrichment Edge Function.
 *
 * Automatically populates homeowner and resident phone numbers for property leads
 * using automated skip-tracing APIs (BatchData, RealEstateAPI, SkipGenie) with
 * built-in caching and public directory fallback.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { recordIntegrationRun } from '../_shared/integration-run.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BATCHDATA_API_KEY = Deno.env.get('BATCHDATA_API_KEY') || Deno.env.get('SKIPTRACE_API_KEY') || ''
const REALESTATE_API_KEY = Deno.env.get('REALESTATE_API_KEY') || ''

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

function cleanPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return raw.trim()
}

interface ContactResult {
  residentName: string | null
  phone: string | null
  phoneType: 'Wireless' | 'Landline' | 'Unknown'
  carrier: string | null
  secondaryPhones: Array<{ phone: string; type: string; carrier?: string }>
  email?: string | null
  source: 'public_record' | 'third_party_lookup'
}

/**
 * Commercial Skip-Tracing API Lookup via BatchData.
 */
  async function lookupBatchData(
    street: string,
    city: string,
    state: string,
    zip: string,
    apiKey: string
  ): Promise<ContactResult | null> {
    const res = await fetch('https://api.batchdata.com/api/v1/property/skip-trace', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            propertyAddress: {
              street,
              city,
              state,
              zip,
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      throw new Error(`BatchData returned HTTP ${res.status}. Check the provider credential and account balance.`)
    }
    const data = await res.json()
    const persons =
      data?.results?.persons ||
      data?.results?.properties?.[0]?.persons ||
      data?.results?.[0]?.persons ||
      data?.data?.results?.persons ||
      []

    const match = Array.isArray(persons) ? persons[0] : null
    if (!match) return null

    const residentName = `${match.name?.first ?? ''} ${match.name?.last ?? ''}`.trim() || null
    const rawPhones = match.phoneNumbers || match.phones || []
    const phones = (Array.isArray(rawPhones) ? rawPhones : []).map((p: Record<string, unknown>) => ({
      phone: String(p.number || p.phone || ''),
      type: String(p.type ?? 'Unknown').toLowerCase().includes('mobile') ? 'Wireless' : 'Landline',
      carrier: String(p.carrier ?? ''),
    })).filter((p: { phone: string }) => p.phone.length >= 10)

    const emails = match.emails || []
    const email = emails.length > 0 ? String(emails[0].email || emails[0]) : null

    if (phones.length === 0 && !email) return null

    return {
      residentName,
      phone: phones.length > 0 ? phones[0].phone : null,
      phoneType: phones.length > 0 ? phones[0].type : 'Unknown',
      carrier: phones.length > 0 ? phones[0].carrier || null : null,
      secondaryPhones: phones.slice(1),
      email,
      source: 'third_party_lookup',
    }
  }

/**
 * Property details / owner lookup via BatchData Property Search API.
 */
async function lookupBatchDataOwner(
  street: string,
  city: string,
  state: string,
  apiKey: string
): Promise<string | null> {
  try {
    const res = await fetch('https://api.batchdata.com/api/v1/property/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        searchCriteria: {
          'address.street': { equals: street },
          'address.city': { equals: city },
          'address.state': { equals: state },
        },
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const prop = data?.results?.properties?.[0]
    return prop?.owner?.fullName || prop?.owner?.names?.[0]?.full || null
  } catch {
    return null
  }
}

/**
 * Commercial Skip-Tracing API Lookup via RealEstateAPI.
 */
async function lookupRealEstateApi(
  street: string,
  city: string,
  state: string,
  zip: string,
  apiKey: string
): Promise<ContactResult | null> {
    const res = await fetch('https://api.realestateapi.com/v2/PropertySkipTrace', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        address: street,
        city,
        state,
        zip,
      }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) throw new Error(`RealEstateAPI returned HTTP ${res.status}. Check the provider credential and account status.`)
    const data = await res.json()
    const match = data?.data?.[0] || data?.data
    if (!match) return null

    const residentName = match.ownerName || `${match.firstName ?? ''} ${match.lastName ?? ''}`.trim() || null
    const rawPhones = match.phoneNumbers || match.phones || []
    const phones = (Array.isArray(rawPhones) ? rawPhones : []).map((p: Record<string, unknown> | string) => {
      const num = typeof p === 'string' ? p : String(p.phone || p.number || '')
      const type = typeof p === 'object' && String(p.type || '').toLowerCase().includes('mobile') ? 'Wireless' : 'Landline'
      return { phone: cleanPhone(num), type }
    }).filter(p => p.phone.length >= 10)

    const emails = match.emails || []
    const email = emails.length > 0 ? String(emails[0]) : null

    if (phones.length === 0 && !email) return null

    return {
      residentName,
      phone: phones.length > 0 ? phones[0].phone : null,
      phoneType: phones.length > 0 ? phones[0].type : 'Unknown',
      carrier: null,
      secondaryPhones: phones.slice(1),
      email,
      source: 'third_party_lookup',
    }
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

  // Auth enforcement
  const { requireAuth } = await import('../_shared/auth.ts');
  let organizationId: string
  let caller: Awaited<ReturnType<typeof requireAuth>>
  try {
    caller = await requireAuth(req);
    // Match the application's earliest active membership selection.
    const { data: memberships, error } = await caller.asCaller.from('organization_members').select('organization_id').eq('user_id',caller.userId).eq('is_active',true).order('created_at',{ascending:true}).limit(1)
    if(error || !memberships?.length) return json({ error: 'An active company account is required.' },403)
    organizationId=memberships[0].organization_id;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized'
    return json({ error: message }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
    if (body.action === 'balance' && BATCHDATA_API_KEY) {
      const res = await fetch('https://api.batchdata.com/api/v1/user/balance', {
        headers: { 'Authorization': `Bearer ${BATCHDATA_API_KEY}` }
      })
      const data = await res.text()
      return json({ balance: data })
    }
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const report = (status: 'success'|'failed'|'not_configured', detail: string) => recordIntegrationRun(db,organizationId,'contacts',status,detail)
  const street = String(body.street || body.address || '').trim()
  const city = String(body.city || 'Baton Rouge').trim()
  const state = String(body.state || 'LA').trim()
  const zip = String(body.zip || body.postalCode || '70810').trim()

  if (!street) {
    return json({ error: 'street address is required' }, 400)
  }

  try {
    // 1. Check Supabase CRM database cache first
    if (SUPABASE_URL && SERVICE_ROLE_KEY) {
      const { data: lead } = await caller.asCaller.from('leads')
        .select('customers(first_name,last_name,primary_phone,email),properties!inner(address_line1,city,state,postal_code)')
        .eq('organization_id',organizationId).ilike('properties.address_line1',street.replace(/[\\%_]/g,'\\$&'))
        .ilike('properties.city',city).ilike('properties.state',state).eq('properties.postal_code',zip).limit(1).maybeSingle()
      const customer = lead?.customers as unknown as {first_name?:string;last_name?:string;primary_phone?:string;email?:string}|null
      if (customer?.primary_phone || customer?.email) {
        return json({success:true,residentName:[customer.first_name,customer.last_name].filter(Boolean).join(' ')||null,
          phone:customer.primary_phone?cleanPhone(customer.primary_phone):null,email:customer.email??null,
          phoneType:'Unknown',carrier:null,secondaryPhones:[],source:'third_party_lookup'})
      }
    }

    const {data:permission,error:permissionError}=await caller.asCaller.from('contact_provider_settings')
      .select('entitlement,commercial_use_confirmed,secondary_providers_enabled').eq('organization_id',organizationId).maybeSingle()
    if(permissionError || permission?.entitlement!=='business_api' || permission.commercial_use_confirmed!==true) {
      await report('not_configured','Confirm the approved business provider agreement in Contact Enrichment settings.')
      return json({success:false,status:'BUSINESS_USE_NOT_CONFIRMED',message:'Confirm your business provider agreement in Settings → Contact Enrichment before running paid lookups.'})
    }
    // 2. Automated Skip-Tracing via BatchData API
    let ownerFromBatch: string | null = null
    if (BATCHDATA_API_KEY) {
      const batchResult = await lookupBatchData(street, city, state, zip, BATCHDATA_API_KEY)
      if (batchResult && (batchResult.phone || batchResult.email)) {
        await report('success','Contact details returned by BatchData.')
        return json({ success: true, ...batchResult })
      }
      ownerFromBatch = await lookupBatchDataOwner(street, city, state, BATCHDATA_API_KEY)
    }

    // 3. Automated Skip-Tracing via RealEstateAPI
    if (REALESTATE_API_KEY && (!BATCHDATA_API_KEY || permission.secondary_providers_enabled===true)) {
      const reResult = await lookupRealEstateApi(street, city, state, zip, REALESTATE_API_KEY)
      if (reResult && (reResult.phone || reResult.email)) {
        await report('success','Contact details returned by RealEstateAPI.')
        return json({ success: true, ...reResult })
      }
    }

    if (!BATCHDATA_API_KEY && !REALESTATE_API_KEY) {
      await report('not_configured','Add a business contact-provider API credential on the server.')
      return json({
        success: false,
        status: 'PROVIDER_NOT_CONFIGURED',
        configuredProvider: 'none',
        message: 'No approved contact-enrichment provider credential is configured on the server.',
      })
    }

    await report('success','Provider lookup completed; no matched phone or email for this property.')
    return json({
      success: false,
      residentName: ownerFromBatch,
      configuredProvider: BATCHDATA_API_KEY ? 'batchdata' : REALESTATE_API_KEY ? 'realestateapi' : 'none',
      message: 'The provider completed this lookup but found no matched phone or email for this property.',
      searchUrl: `https://www.fastpeoplesearch.com/address/${street.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}_${city.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${state.toLowerCase()}-${zip}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lookup failed'
    await report('failed',(/^(BatchData|RealEstateAPI) returned HTTP/.test(message))?message:'Contact provider could not complete the lookup.')
    // Preserve provider HTTP failures so callers can distinguish them from a valid no-match result.
    if (/^(BatchData|RealEstateAPI) returned HTTP/.test(message)) {
      return json({
        success: false,
        configuredProvider: message.startsWith('RealEstateAPI') ? 'realestateapi' : 'batchdata',
        message: message
      }, 200)
    }
    return json({ error: message }, 500)
  }
})
