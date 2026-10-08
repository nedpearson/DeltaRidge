import { createClient } from 'npm:@supabase/supabase-js@2'
import { requireOrgMember } from '../_shared/auth.ts'
const cors = { 'access-control-allow-origin':'*','access-control-allow-headers':'authorization, x-client-info, apikey, content-type, x-application-name' }
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}})
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
 if(req.method!=='POST') return json({error:'POST only'},405)
 let body: Record<string,unknown>
 try { body=await req.json() } catch {return json({error:'Invalid request'},400)}
 if(typeof body.organizationId!=='string') return json({error:'Organization is required'},400)
 try {
  const {userId}=await requireOrgMember(req,body.organizationId)
  const publicKey=Deno.env.get('VAPID_PUBLIC_KEY')
  if(!publicKey || !Deno.env.get('VAPID_PRIVATE_KEY') || !Deno.env.get('VAPID_SUBJECT')) return json({error:'Push server keys are missing'},503)
  if(body.action==='config') return json({publicKey})
  if(body.action==='test') {
   const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
   const {data:recent}=await db.from('notifications').select('id').eq('organization_id',body.organizationId).eq('user_id',userId).eq('reference_entity','push_test').gte('created_at',new Date(Date.now()-60000).toISOString()).limit(1)
   if(recent?.length) return json({error:'Wait one minute before sending another test.'},429)
   const {error}=await db.from('notifications').insert({organization_id:body.organizationId,user_id:userId,title:'Delta Ridge alerts are connected',body:'This is your device notification test.',reference_entity:'push_test',link_url:'/settings?tab=notifications'})
   return error?json({error:'Could not queue the test alert'},503):json({ok:true})
  }
  if(body.action!=='subscribe') return json({error:'Unknown action'},400)
  const subscription=body.subscription as {endpoint?:unknown;keys?:{p256dh?:unknown;auth?:unknown}}|undefined
  if(typeof subscription?.endpoint!=='string'||typeof subscription.keys?.p256dh!=='string'||typeof subscription.keys?.auth!=='string') return json({error:'Invalid device subscription'},400)
  const url=new URL(subscription.endpoint)
  // Restrict destinations so the privileged delivery worker cannot become an SSRF proxy.
  if(url.protocol!=='https:' || (url.port!=='' && url.port!=='443') || url.username!=='' || !['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns.windows.com'].some(host=>url.hostname===host || (host==='wns.windows.com' && url.hostname.endsWith('.wns.windows.com')))) return json({error:'Unsupported push provider'},400)
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const {data:existing}=await db.from('push_subscriptions').select('id,user_id').eq('endpoint',subscription.endpoint).maybeSingle()
  if(existing && existing.user_id!==userId) return json({error:'This device is registered to another account. Disable its alerts before switching accounts.'},409)
  const {error}=await db.from('push_subscriptions').upsert({organization_id:body.organizationId,user_id:userId,endpoint:subscription.endpoint,p256dh:subscription.keys.p256dh,auth_key:subscription.keys.auth,active:true},{onConflict:'endpoint'})
  return error?json({error:'Could not save this device'},503):json({ok:true})
 } catch {return json({error:'Sign in with an active organization account'},401)}
})
