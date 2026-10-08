import { requireOrgMember } from '../_shared/auth.ts'
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-application-name' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } })
Deno.serve(async (req: Request) => {
 if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
 if (req.method !== 'POST') return json({ error: 'POST only' },405)
 let organizationId: string
 try { const body = await req.json(); organizationId = body.organizationId; if (typeof organizationId !== 'string') return json({ error: 'Organization is required' },400) } catch { return json({ error: 'Invalid request' },400) }
 try {
  const { asCaller } = await requireOrgMember(req,organizationId)
  const { data: runs, error } = await asCaller.from('integration_runs').select('integration,status,detail,created_at')
   .eq('organization_id',organizationId).gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:false}).limit(1000)
  if (error) return json({ error: 'Integration telemetry has not been deployed.' },503)
  const present = (name: string) => Boolean(Deno.env.get(name))
  return json({ configured: {
   contacts: present('BATCHDATA_API_KEY') || present('SKIPTRACE_API_KEY') || present('REALESTATE_API_KEY'),
   push: present('VAPID_PUBLIC_KEY') && present('VAPID_PRIVATE_KEY') && present('VAPID_SUBJECT'),
   roofr: present('ZAPIER_ROOFR_HOOK_URL'),
  }, runs: runs ?? [] })
 } catch { return json({ error: 'Sign in with an active organization account.' },401) }
})
