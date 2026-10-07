import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { CONTACT_DISCLOSURE, validateIntake, type InspectionIntake } from '../../../src/features/acquisition/intake.ts'

serve(async req => {
  const origin = req.headers.get('origin') ?? ''
  const allowed = (Deno.env.get('PUBLIC_ACQUISITION_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : '',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (!allowed.includes(origin)) return json({ error: 'This website is not enabled for inspection requests.' }, 403)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const org = Deno.env.get('PUBLIC_ACQUISITION_ORG_ID')
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url = Deno.env.get('SUPABASE_URL')
  const captchaSecret = Deno.env.get('TURNSTILE_SECRET_KEY')
  if (!org || !key || !url || !captchaSecret) return json({ error: 'Online requests are not available yet. Please contact the office.' }, 503)
  try {
    const raw = await req.text()
    if (raw.length > 12000) return json({ error: 'Request too large' }, 413)
    const body = JSON.parse(raw)
    const db = createClient(url, key, { auth: { persistSession: false } })
    // A trusted ingress IP is used where supplied; otherwise share a fail-closed bucket.
    const ip = req.headers.get('x-real-ip') ?? 'unknown'
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${org}:${ip}`)))
    const bucket = Array.from(bytes, b => b.toString(16).padStart(2,'0')).join('')
    const { data: permitted, error: rateError } = await db.rpc('consume_acquisition_limit', { p_bucket: bucket })
    if (rateError) throw rateError
    if (!permitted) return json({ error: 'Too many attempts. Please try later.' }, 429)
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: new URLSearchParams({ secret: captchaSecret, response: typeof body.captchaToken === 'string' ? body.captchaToken : '' })
    })
    const captcha = await verification.json()
    if (!verification.ok || !captcha.success || captcha.action !== 'inspection_request' || !allowed.some(value => new URL(value).hostname === captcha.hostname)) {
      return json({ error: 'Please complete the security check and try again.' }, 400)
    }
    if (body.action === 'lookup') {
      if (typeof body.address !== 'string' || body.address.length < 8 || body.address.length > 300) return json({ error: 'Enter a full address.' }, 400)
      const { data, error } = await db.rpc('check_storm_exposure_for_address', { org_id: org, search_address: body.address.trim() })
      if (error) throw error
      return json({ status: data?.status === 'exposed' ? 'exposed' : 'unable_to_determine', occurredAt: data?.occurred_at ?? null })
    }
    const input: InspectionIntake = {
      requestKey: typeof body.requestKey === 'string' ? body.requestKey : '',
      name: typeof body.name === 'string' ? body.name.trim() : '', address: typeof body.address === 'string' ? body.address.trim() : '',
      phone: typeof body.phone === 'string' ? body.phone.trim() : '', email: typeof body.email === 'string' ? body.email.trim().toLowerCase() : '',
      preferredDay: typeof body.preferredDay === 'string' ? body.preferredDay : '', notes: typeof body.notes === 'string' ? body.notes.trim() : '',
      contactConsent: body.contactConsent === true, website: typeof body.website === 'string' ? body.website : '',
      attribution: Object.fromEntries(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ref','gclid','fbclid']
        .flatMap(k => typeof body.attribution?.[k] === 'string' ? [[k,body.attribution[k].slice(0,200)]] : []))
    }
    const error = validateIntake(input)
    if (error || input.website) return json({ error: error ?? 'Unable to submit this request.' }, 400)
    const { error: submitError } = await db.rpc('submit_inspection_request', { p_org: org, p_payload: { ...input, contactDisclosure: CONTACT_DISCLOSURE } })
    if (submitError) throw submitError
    // No CRM IDs or private property details cross into the public response.
    return json({ success: true, status: 'requested' })
  } catch (error) {
    console.error('Public acquisition request failed', error instanceof Error ? error.message : 'Unknown error')
    return json({ error: 'We could not save your request. Please retry or contact the office.' }, 500)
  }
})
