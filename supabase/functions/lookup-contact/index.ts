/**
 * Resident Contact & Phone Enrichment Edge Function.
 *
 * Populates homeowner and resident phone numbers for property leads using
 * public directories and optional commercial skip-tracing API keys.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BATCHDATA_API_KEY = Deno.env.get('BATCHDATA_API_KEY') || Deno.env.get('SKIPTRACE_API_KEY') || ''

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
  source: 'public_record' | 'third_party_lookup'
}

/**
 * Fast public directory lookup for US addresses.
 */
async function lookupPublicDirectory(
  street: string,
  city: string,
  state: string,
  zip: string
): Promise<ContactResult | null> {
  const streetSlug = street.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
  const citySlug = city.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-')
  const slug = `${streetSlug}_${citySlug}-${state.toLowerCase()}-${zip}`
  const url = `https://www.fastpeoplesearch.com/address/${slug}`

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) return null
  const html = await response.text()

  // Find person link
  const personMatch = html.match(/href="(\/[a-z0-9-]+_id_[A-Za-z0-9-]+)"/i)
  if (!personMatch) {
    // Check if phone is directly present on page
    const directPhones = [...html.matchAll(/(\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4})/g)].map(m => cleanPhone(m[0]))
    const uniquePhones = Array.from(new Set(directPhones))
    if (uniquePhones.length > 0) {
      return {
        residentName: null,
        phone: uniquePhones[0],
        phoneType: 'Wireless',
        carrier: null,
        secondaryPhones: uniquePhones.slice(1).map(p => ({ phone: p, type: 'Unknown' })),
        source: 'public_record',
      }
    }
    return null
  }

  const personUrl = `https://www.fastpeoplesearch.com${personMatch[1]}`
  const personRes = await fetch(personUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!personRes.ok) return null
  const personHtml = await personRes.text()

  // Extract Person Name
  const nameMatch = personHtml.match(/<h1[^>]*class="[^"]*larger[^"]*"[^>]*>([^<]+)<\/h1>/i) ||
                    personHtml.match(/<title>([^<|]+)\|/i)
  const residentName = nameMatch ? nameMatch[1].replace(/free people search/i, '').trim() : null

  // Extract Phones with details
  const phoneBlocks = [...personHtml.matchAll(/<a[^>]*href="\/(\d{3}-\d{3}-\d{4})"[^>]*>\((\d{3}\))\s*(\d{3}-\d{4})<\/a>[\s\S]*?(Wireless|Landline)?[\s\S]*?([A-Za-z0-9\s.,-]+(?:Wireless|Telecommunications|Verizon|AT&T|T-Mobile|Comcast|Bell)[^<\n]*)?/gi)]

  const phonesList: Array<{ phone: string; type: 'Wireless' | 'Landline' | 'Unknown'; carrier?: string }> = []

  for (const block of phoneBlocks) {
    const rawNum = block[1] || `${block[2]} ${block[3]}`
    const num = cleanPhone(rawNum)
    const type = (block[4] as 'Wireless' | 'Landline') || 'Wireless'
    const carrier = block[5] ? block[5].trim() : undefined
    if (!phonesList.some(p => p.phone === num)) {
      phonesList.push({ phone: num, type, carrier })
    }
  }

  // Fallback regex if specific html parsing matched zero
  if (phonesList.length === 0) {
    const rawMatches = [...personHtml.matchAll(/(\(\d{3}\)\s*\d{3}-\d{4}|\d{3}-\d{3}-\d{4})/g)].map(m => cleanPhone(m[0]))
    const unique = Array.from(new Set(rawMatches))
    for (const p of unique) {
      phonesList.push({ phone: p, type: 'Unknown' })
    }
  }

  if (phonesList.length === 0) return null

  // Prefer Wireless over Landline as primary
  const primary = phonesList.find(p => p.type === 'Wireless') || phonesList[0]
  const secondaries = phonesList.filter(p => p.phone !== primary.phone)

  return {
    residentName,
    phone: primary.phone,
    phoneType: primary.type,
    carrier: primary.carrier ?? null,
    secondaryPhones: secondaries,
    source: 'public_record',
  }
}

/**
 * Commercial Skip-Tracing API Lookup (BatchData / SkipGenie / RealEstateAPI).
 */
async function lookupCommercialApi(
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
            address: {
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
    const match = data?.results?.persons?.[0]
    if (!match) return null

    const residentName = `${match.name?.first ?? ''} ${match.name?.last ?? ''}`.trim() || null
    const phones = (match.phoneNumbers ?? []).map((p: Record<string, unknown>) => ({
      phone: cleanPhone(String(p.number ?? '')),
      type: String(p.type ?? 'Unknown').toLowerCase().includes('mobile') ? 'Wireless' : 'Landline',
      carrier: String(p.carrier ?? ''),
    }))

    if (phones.length === 0) return null

    return {
      residentName,
      phone: phones[0].phone,
      phoneType: phones[0].type,
      carrier: phones[0].carrier || null,
      secondaryPhones: phones.slice(1),
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
    // 1. If commercial API key is present, try commercial skip trace first
    if (BATCHDATA_API_KEY) {
      const commercialResult = await lookupCommercialApi(street, city, state, zip, BATCHDATA_API_KEY)
      if (commercialResult && commercialResult.phone) {
        return json({ success: true, ...commercialResult })
      }
    }

    // 2. Free public directory lookup
    const publicResult = await lookupPublicDirectory(street, city, state, zip)
    if (publicResult && publicResult.phone) {
      return json({ success: true, ...publicResult })
    }

    return json({
      success: false,
      message: 'No public phone number found on file for this residence.',
      searchUrl: `https://www.truepeoplesearch.com/resultaddress?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state} ${zip}`)}`,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lookup failed'
    return json({ error: message }, 500)
  }
})
