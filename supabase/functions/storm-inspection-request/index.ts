// Public storm-check funnel backend.
//
// Two actions, both called from /free-roof-check with only the anon key:
//   check  — geocode an address and look up radar hail near it. No writes.
//   submit — the homeowner's qualified inspection request: property, customer,
//            lead, TCPA consent (only if they ticked it), insurance answer,
//            requested appointment, an activity, an inspection_requests row
//            with the heat score, and an org-wide notification to the reps.
//
// verify_jwt is off because homeowners have no account. Abuse controls are in
// here instead: a honeypot field, a minimum fill time, strict value checks, and
// a per-phone daily cap that returns the existing request instead of a new one.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  CLAIM_VALUES,
  DAMAGE_VALUES,
  INSURANCE_VALUES,
  ROOF_AGE_VALUES,
  oneOf,
  scoreHeat,
  type HeatAnswers,
  type HeatStorm,
} from '../_shared/heat.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FUNNEL_ORG_ID = Deno.env.get('PUBLIC_FUNNEL_ORG_ID') ?? ''

/** Bump when the consent wording on the page changes; stored with every consent. */
const CONSENT_VERSION = 'storm-check-v1-2026-10-08'

const ALLOWED_ORIGINS = [
  'https://deltaridge.bridgebox.ai',
  'https://deltaridge.vercel.app',
  'http://localhost:5173',
]

function cors(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/deltaridge-[a-z0-9-]+\.vercel\.app$/.test(origin))
    ? origin
    : ALLOWED_ORIGINS[0]!
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name',
    Vary: 'Origin',
  }
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  })
}

// ---------------------------------------------------------------- geocoding

interface Geo {
  matchedAddress: string
  line1: string
  city: string | null
  state: string | null
  zip: string | null
  latitude: number
  longitude: number
}

/** US Census geocoder: public, keyless, covers every parish. */
async function geocode(address: string): Promise<Geo | null> {
  const url = new URL('https://geocoding.geo.census.gov/geocoder/locations/onelineaddress')
  url.searchParams.set('address', address)
  url.searchParams.set('benchmark', 'Public_AR_Current')
  url.searchParams.set('format', 'json')
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`geocoder ${res.status}`)
  const body = await res.json() as {
    result?: { addressMatches?: Array<{
      matchedAddress: string
      coordinates: { x: number; y: number }
      addressComponents?: { city?: string; state?: string; zip?: string }
    }> }
  }
  const m = body.result?.addressMatches?.[0]
  if (!m) return null
  const parts = m.matchedAddress.split(',').map((s) => s.trim())
  return {
    matchedAddress: m.matchedAddress,
    line1: parts[0] ?? address,
    city: m.addressComponents?.city ?? parts[1] ?? null,
    state: m.addressComponents?.state ?? parts[2] ?? null,
    zip: m.addressComponents?.zip ?? parts[3] ?? null,
    latitude: m.coordinates.y,
    longitude: m.coordinates.x,
  }
}

// -------------------------------------------------------------- storm check

interface StormFinding extends HeatStorm {
  readonly date: string | null
  readonly detections: number
  readonly source: 'NOAA NCEI SWDI nx3hail (radar-estimated)'
}

const SEARCH_DEG = 0.027 // ~3 km either side
const MONTHS_BACK = 24

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function monthWindows(now: Date): Array<[Date, Date]> {
  const out: Array<[Date, Date]> = []
  for (let i = 0; i < MONTHS_BACK + 1; i += 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1))
    const end = new Date(Math.min(next.getTime() - 86_400_000, now.getTime()))
    out.push([start, end])
  }
  return out
}

/** Radar hail near a point over 24 months; the strongest *scoring* day wins. */
async function stormNear(lat: number, lon: number): Promise<StormFinding> {
  const bbox = `${lon - SEARCH_DEG},${lat - SEARCH_DEG},${lon + SEARCH_DEG},${lat + SEARCH_DEG}`
  const now = new Date()
  const windows = monthWindows(now)
  const rows: Array<{ size: number; time: string }> = []
  let failures = 0

  const queue = [...windows]
  async function worker() {
    for (let w = queue.shift(); w; w = queue.shift()) {
      try {
        const url = `https://www.ncei.noaa.gov/swdiws/csv/nx3hail/${ymd(w[0])}:${ymd(w[1])}?bbox=${bbox}`
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
        if (!res.ok) { failures += 1; continue }
        const text = (await res.text()).trim()
        if (!text || text.startsWith('summary')) continue
        if (text.startsWith('error')) { failures += 1; continue }
        const lines = text.split(/\r?\n/)
        const header = (lines[0] ?? '').split(',')
        const iT = header.indexOf('ZTIME')
        const iS = header.indexOf('MAXSIZE')
        for (const line of lines.slice(1)) {
          if (!line || line.startsWith('summary')) break
          const p = line.split(',')
          const size = Number.parseFloat(p[iS] ?? '')
          const time = p[iT] ?? ''
          if (Number.isFinite(size) && time) rows.push({ size, time })
        }
      } catch {
        failures += 1
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))

  const base = { source: 'NOAA NCEI SWDI nx3hail (radar-estimated)' as const, detections: rows.length }
  if (rows.length === 0) {
    // Most windows failing means we do not know, which is not the same as "no hail".
    const unavailable = failures > windows.length / 2
    return { ...base, maxHailInches: null, daysSince: null, date: null, unavailable }
  }

  const rank = (size: number, days: number) =>
    (days <= 365 && size >= 1.5 ? 3 : days <= 365 && size >= 1.0 ? 2 : size >= 1.0 ? 1 : 0) * 100 + size
  let best: { size: number; days: number; date: string } | null = null
  for (const r of rows) {
    const t = Date.parse(r.time.replace(' ', 'T') + (r.time.endsWith('Z') ? '' : 'Z'))
    if (!Number.isFinite(t)) continue
    const days = Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
    if (!best || rank(r.size, days) > rank(best.size, best.days)) {
      best = { size: r.size, days, date: new Date(t).toISOString().slice(0, 10) }
    }
  }
  if (!best) return { ...base, maxHailInches: null, daysSince: null, date: null, unavailable: false }
  return { ...base, maxHailInches: best.size, daysSince: best.days, date: best.date, unavailable: false }
}

// ------------------------------------------------------------------- submit

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function phoneDigits(v: unknown): string | null {
  const d = str(v, 30).replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(ten) ? ten : null
}

function formatPhone(d: string): string {
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
}

async function resolveOrg(db: SupabaseClient): Promise<string> {
  if (FUNNEL_ORG_ID) return FUNNEL_ORG_ID
  const { data, error } = await db.from('organizations').select('id').limit(2)
  if (error) throw error
  if (!data || data.length !== 1) throw new Error('PUBLIC_FUNNEL_ORG_ID must be set when more than one organization exists.')
  return data[0]!.id as string
}

async function submit(db: SupabaseClient, body: Record<string, unknown>, req: Request) {
  // Bots fill every field and submit instantly.
  if (str(body.company, 200)) return { status: 200, body: { ok: true } }
  const elapsed = Number(body.elapsedMs)
  if (!Number.isFinite(elapsed) || elapsed < 4000) return { status: 400, body: { error: 'Please take a moment to review the form.' } }

  const name = str(body.name, 80)
  const phone = phoneDigits(body.phone)
  const emailRaw = str(body.email, 120).toLowerCase()
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailRaw) ? emailRaw : null
  const address = str(body.address, 200)
  const carrier = str(body.carrier, 80) || null
  const consent = body.consent === true
  const consentText = str(body.consentText, 1200)

  const damage = oneOf(DAMAGE_VALUES, body.damage)
  const roofAge = oneOf(ROOF_AGE_VALUES, body.roofAge)
  const insurance = oneOf(INSURANCE_VALUES, body.insurance)
  const claim = oneOf(CLAIM_VALUES, body.claim)
  const owner = body.owner === true ? true : body.owner === false ? false : null

  if (name.length < 2) return { status: 400, body: { error: 'Please enter your name.' } }
  if (!phone) return { status: 400, body: { error: 'Please enter a valid 10-digit phone number.' } }
  if (address.length < 6) return { status: 400, body: { error: 'Please enter the property address.' } }
  if (!damage || !roofAge || !insurance || !claim || owner === null) {
    return { status: 400, body: { error: 'Please answer each question.' } }
  }
  if (consent && !consentText) return { status: 400, body: { error: 'Consent text missing.' } }

  let preferredStart: Date | null = null
  if (typeof body.preferredStart === 'string' && body.preferredStart) {
    const t = new Date(body.preferredStart)
    const now = Date.now()
    if (!Number.isFinite(t.getTime()) || t.getTime() < now || t.getTime() > now + 21 * 86_400_000) {
      return { status: 400, body: { error: 'Please pick an inspection time in the next three weeks.' } }
    }
    preferredStart = t
  }

  const orgId = await resolveOrg(db)

  // Same phone twice in a day: keep the first request, don't spam the reps.
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { data: recent } = await db
    .from('inspection_requests')
    .select('id, preferred_start')
    .eq('organization_id', orgId)
    .eq('contact_phone', phone)
    .gte('created_at', since)
    .limit(1)
  if (recent && recent.length > 0) {
    return { status: 200, body: { ok: true, duplicate: true, booked: Boolean(recent[0]!.preferred_start) } }
  }

  let geo: Geo | null = null
  try { geo = await geocode(address) } catch { geo = null }
  const storm: StormFinding = geo
    ? await stormNear(geo.latitude, geo.longitude)
    : { maxHailInches: null, daysSince: null, date: null, unavailable: true, detections: 0, source: 'NOAA NCEI SWDI nx3hail (radar-estimated)' }

  const answers: HeatAnswers = {
    owner,
    damage,
    roofAge,
    insurance,
    claim,
    slotChosen: preferredStart !== null,
    decisionMakersPresent: body.decisionMakers === true,
  }
  const heat = scoreHeat(answers, storm)

  const line1 = geo?.line1 ?? address
  const nowIso = new Date().toISOString()

  // Property
  const { data: found, error: findErr } = await db.rpc('resolve_property_from_address', { org_id: orgId, address_query: line1 })
  if (findErr) throw findErr
  let propertyId = (found as Array<{ id: string }> | null)?.[0]?.id ?? null
  const point = geo ? `SRID=4326;POINT(${geo.longitude} ${geo.latitude})` : null
  if (!propertyId) {
    const { data, error } = await db.from('properties').insert({
      organization_id: orgId,
      address_line1: line1,
      city: geo?.city ?? null,
      state: geo?.state ?? 'LA',
      postal_code: geo?.zip ?? null,
      location: point,
      geocode_source: geo ? 'census' : null,
      geocode_verified_at: geo ? nowIso : null,
      roof_age_basis: null,
    }).select('id').single()
    if (error) throw error
    propertyId = data.id as string
  } else if (point) {
    await db.from('properties').update({ location: point, geocode_source: 'census', geocode_verified_at: nowIso })
      .eq('id', propertyId).is('location', null)
  }

  // Customer: the number came from them, in writing.
  const [first, ...rest] = name.split(/\s+/)
  const { data: existingCustomer } = await db.from('customers').select('id, phone_source')
    .eq('organization_id', orgId).eq('phone_digits', phone).is('deleted_at', null).limit(1).maybeSingle()
  let customerId = (existingCustomer?.id as string | undefined) ?? null
  if (customerId) {
    const patch: Record<string, unknown> = { phone_source: 'homeowner_in_writing' }
    if (email) patch.email = email
    await db.from('customers').update(patch).eq('id', customerId)
  } else {
    const { data, error } = await db.from('customers').insert({
      organization_id: orgId,
      first_name: first ?? name,
      last_name: rest.join(' ') || null,
      primary_phone: formatPhone(phone),
      email,
      email_source: email ? 'homeowner_in_writing' : null,
      phone_source: 'homeowner_in_writing',
      notes: 'Requested an inspection through the storm check page.',
    }).select('id').single()
    if (error) throw error
    customerId = data.id as string
  }

  const { data: ownerLink } = await db.from('property_owners').select('id')
    .eq('property_id', propertyId).eq('customer_id', customerId).maybeSingle()
  if (!ownerLink && owner) {
    await db.from('property_owners').insert({ property_id: propertyId, customer_id: customerId, is_current: true })
  }

  // Lead source carries the channel so cost-per-lead can be computed per source.
  const utmSource = str(body.utm_source, 60) || null
  const utmMedium = str(body.utm_medium, 60) || null
  const utmCampaign = str(body.utm_campaign, 80) || null
  const refCode = str(body.ref, 20).toUpperCase() || null
  const channel = refCode ? 'mailer' : utmSource ?? 'direct'
  const sourceName = `Storm check · ${channel}`
  let { data: source } = await db.from('lead_sources').select('id').eq('organization_id', orgId).eq('name', sourceName).maybeSingle()
  if (!source) {
    const { data, error } = await db.from('lead_sources')
      .insert({ organization_id: orgId, name: sourceName, category: 'web' }).select('id').single()
    if (error) throw error
    source = data
  }

  // Lead: reuse an open one on this property, never downgrade its status.
  const EARLY = ['untouched', 'target', 'attempted', 'no_answer', 'spoke', 'interested']
  const { data: openLead } = await db.from('leads').select('id, status')
    .eq('organization_id', orgId).eq('property_id', propertyId).is('deleted_at', null)
    .not('status', 'in', '(sold,lost,not_interested,do_not_contact)').limit(1).maybeSingle()
  let leadId = (openLead?.id as string | undefined) ?? null
  const leadPatch = {
    customer_id: customerId,
    lead_source_id: source!.id,
    opportunity_score: heat.score,
    score_computed_at: nowIso,
    score_breakdown: { model: 'heat-v1', heat: heat.score, tier: heat.tier, reasons: heat.reasons },
    next_action_at: nowIso,
    next_action_note: preferredStart ? 'Confirm the requested inspection time' : 'Call back — inspection requested online',
    utm_campaign: utmCampaign,
    utm_medium: utmMedium,
  }
  if (leadId) {
    const status = EARLY.includes(openLead!.status as string) ? 'inspection_requested' : openLead!.status
    await db.from('leads').update({ ...leadPatch, status }).eq('id', leadId)
  } else {
    const { data, error } = await db.from('leads').insert({
      organization_id: orgId,
      property_id: propertyId,
      status: 'inspection_requested',
      ...leadPatch,
    }).select('id').single()
    if (error) throw error
    leadId = data.id as string
  }

  // Consent — recorded only when the box was ticked, with what they saw.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = req.headers.get('user-agent')?.slice(0, 400) ?? null
  if (consent) {
    const rows = [
      { contact_kind: 'phone', contact_value: phone, channel: 'voice' },
      { contact_kind: 'phone', contact_value: phone, channel: 'sms' },
      ...(email ? [{ contact_kind: 'email', contact_value: email, channel: 'email' }] : []),
    ].map((r) => ({
      ...r,
      organization_id: orgId,
      lead_id: leadId,
      source: 'web_form',
      opt_in_timestamp: nowIso,
      ip_address: ip,
      user_agent: ua,
    }))
    const { error } = await db.from('contact_consents')
      .upsert(rows, { onConflict: 'organization_id,contact_kind,contact_value,channel' })
    if (error) throw error
  }

  // Insurance: their own answer, never our conclusion.
  await db.from('insurance_profiles').insert({
    organization_id: orgId,
    lead_id: leadId,
    property_id: propertyId,
    has_insurance: insurance === 'yes' ? true : insurance === 'no' ? false : null,
    carrier,
    status: insurance === 'no' ? 'SELF_PAY' : 'UNKNOWN',
    homeowner_confirmed: false,
  })

  let appointmentId: string | null = null
  if (preferredStart) {
    const { data, error } = await db.from('appointments').insert({
      organization_id: orgId,
      lead_id: leadId,
      property_id: propertyId,
      customer_id: customerId,
      scheduled_start: preferredStart.toISOString(),
      scheduled_end: new Date(preferredStart.getTime() + 60 * 60_000).toISOString(),
      status: 'requested',
      notes: 'Requested online by the homeowner — call to confirm.',
    }).select('id').single()
    if (error) throw error
    appointmentId = data.id as string
  }

  await db.from('activities').insert({
    organization_id: orgId,
    lead_id: leadId,
    property_id: propertyId,
    customer_id: customerId,
    activity_type: 'web_request',
    outcome: heat.tier,
    body: `Inspection requested online. ${heat.reasons.join('; ')}`,
    metadata: { answers, carrier, storm, ref: refCode, consent, consentVersion: consent ? CONSENT_VERSION : null },
  })

  const { error: reqErr } = await db.from('inspection_requests').insert({
    organization_id: orgId,
    lead_id: leadId,
    property_id: propertyId,
    customer_id: customerId,
    appointment_id: appointmentId,
    answers: { ...answers, carrier, consentText: consent ? consentText : null },
    storm,
    heat_score: heat.score,
    heat_tier: heat.tier,
    heat_reasons: heat.reasons,
    contact_name: name,
    contact_phone: phone,
    contact_email: email,
    address_text: geo?.matchedAddress ?? address,
    latitude: geo?.latitude ?? null,
    longitude: geo?.longitude ?? null,
    consent_given: consent,
    consent_text_version: consent ? CONSENT_VERSION : null,
    preferred_start: preferredStart?.toISOString() ?? null,
    ref_code: refCode,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  })
  if (reqErr) throw reqErr

  const label = heat.tier === 'hot' ? 'HOT' : heat.tier === 'warm' ? 'Warm' : heat.tier === 'cool' ? 'New' : 'Check'
  await db.from('notifications').insert({
    organization_id: orgId,
    user_id: null,
    title: `${label} inspection request · ${line1}`,
    body: `${name} · ${heat.reasons.slice(0, 3).join(' · ') || 'Requested online'}`,
    priority: heat.tier === 'hot' ? 'critical' : heat.tier === 'warm' ? 'high' : 'medium',
    link_url: `/leads/${leadId}`,
    reference_entity: 'lead',
    reference_id: leadId,
  })

  return { status: 200, body: { ok: true, booked: preferredStart !== null } }
}

// -------------------------------------------------------------------- serve

Deno.serve(async (req) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin)
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Server is not configured.' }, 503, origin)

  let body: Record<string, unknown>
  try {
    body = await req.json() as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid request.' }, 400, origin)
  }

  try {
    if (body.action === 'check') {
      const address = str(body.address, 200)
      if (address.length < 6) return json({ error: 'Please enter the full street address.' }, 400, origin)
      const geo = await geocode(address).catch(() => null)
      if (!geo) return json({ found: false }, 200, origin)
      const storm = await stormNear(geo.latitude, geo.longitude)
      return json({ found: true, matchedAddress: geo.matchedAddress, storm }, 200, origin)
    }
    if (body.action === 'submit') {
      const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      const result = await submit(db, body, req)
      return json(result.body, result.status, origin)
    }
    return json({ error: 'Unknown action.' }, 400, origin)
  } catch (error) {
    console.error('storm-inspection-request failed', error)
    return json({ error: 'Something went wrong on our side. Please call us instead.' }, 500, origin)
  }
})
