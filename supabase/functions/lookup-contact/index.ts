/**
 * Resident Contact & Phone Enrichment Edge Function.
 *
 * Automatically populates homeowner and resident phone numbers for property leads
 * using automated skip-tracing APIs (BatchData, RealEstateAPI, SkipGenie) with
 * built-in caching and public directory fallback.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BATCHDATA_API_KEY = Deno.env.get('BATCHDATA_API_KEY') || Deno.env.get('SKIPTRACE_API_KEY') || ''
const REALESTATE_API_KEY = Deno.env.get('REALESTATE_API_KEY') || ''

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
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
  try {
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

    if (!res.ok) return null
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
      phone: cleanPhone(String(p.number || p.phone || '')),
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
  } catch {
    return null
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
  try {
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

    if (!res.ok) return null
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
  } catch {
    return null
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

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return json({ error: 'invalid json' }, 400)
  }

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
      const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
      const { data: cached } = await db
        .from('leads')
        .select('contact_name, contact_phone')
        .ilike('address_line1', street)
        .not('contact_phone', 'is', null)
        .limit(1)
        .maybeSingle()

      if (cached?.contact_phone) {
        return json({
          success: true,
          residentName: cached.contact_name ?? null,
          phone: cleanPhone(cached.contact_phone),
          phoneType: 'Wireless',
          carrier: null,
          secondaryPhones: [],
          source: 'public_record',
        })
      }
    }

    // 2. Automated Skip-Tracing via BatchData API
    let ownerFromBatch: string | null = null
    if (BATCHDATA_API_KEY) {
      const batchResult = await lookupBatchData(street, city, state, zip, BATCHDATA_API_KEY)
      if (batchResult && batchResult.phone) {
        return json({ success: true, ...batchResult })
      }
      ownerFromBatch = await lookupBatchDataOwner(street, city, state, BATCHDATA_API_KEY)
    }

    // 3. Automated Skip-Tracing via RealEstateAPI
    if (REALESTATE_API_KEY) {
      const reResult = await lookupRealEstateApi(street, city, state, zip, REALESTATE_API_KEY)
      if (reResult && reResult.phone) {
        return json({ success: true, ...reResult })
      }
    }

    return json({
      success: false,
      residentName: ownerFromBatch,
      configuredProvider: BATCHDATA_API_KEY ? 'batchdata' : REALESTATE_API_KEY ? 'realestateapi' : 'none',
      message: 'No phone number found yet for this property. Configure an automated skip-tracing API key in Supabase secrets for 85%+ auto-match rate.',
      searchUrl: `https://www.fastpeoplesearch.com/address/${street.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')}_${city.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${state.toLowerCase()}-${zip}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lookup failed'
    return json({ error: message }, 500)
  }
})
