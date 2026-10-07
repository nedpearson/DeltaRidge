import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
import { requireAuth } from '../_shared/auth.ts'
const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' }
serve(async req => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response(null, { headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  let userId: string
  try { userId = (await requireAuth(req)).userId } catch { return json({ error: 'Sign in to confirm inspection requests.' }, 401) }
  try {
    const body = await req.json()
    if (typeof body.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.requestId) || typeof body.start !== 'string' || !Number.isFinite(Date.parse(body.start))) return json({ error: 'Choose a valid request and appointment time.' }, 400)
    const db = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await db.rpc('confirm_inspection_request', { p_request: body.requestId, p_start: body.start, p_actor: userId })
    if (error) return json({ error: 'Unable to book. Check your access, lead status, and representative availability.' }, 409)
    return json({ success: true, appointmentId: data })
  } catch { return json({ error: 'Unable to confirm this inspection.' }, 500) }
})
