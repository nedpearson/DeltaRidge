import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
// Until delivery and review URL configuration are verified, create an office
// follow-up task and explicitly report that no message was delivered.
serve(async req => {
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const url=Deno.env.get('SUPABASE_URL')
  if(!key||!url) return json({error:'Server is not configured'},503)
  if(req.headers.get('authorization')!==`Bearer ${key}`) return json({error:'Trusted webhook authentication required'},401)
  try {
    const {record,old_record}=await req.json()
    if(!record?.id || record.status!=='sold' || old_record?.status==='sold') return json({queued:false,delivered:false})
    const db=createClient(url,key)
    const {data:lead,error:leadError}=await db.from('leads').select('id,organization_id,status').eq('id',record.id).single()
    if(leadError||lead?.status!=='sold') return json({error:'Sold lead not found'},404)
    const {error}=await db.rpc('queue_review_followup',{p_org:lead.organization_id,p_lead:lead.id})
    if(error) throw error
    return json({queued:true,delivered:false,reason:'Office follow-up required. No review message has been sent.'})
  }catch{return json({error:'Unable to queue review follow-up',delivered:false},500)}
})
