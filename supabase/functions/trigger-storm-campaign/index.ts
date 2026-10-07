import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'
serve(async req => {
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}})
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');const url=Deno.env.get('SUPABASE_URL')
  if(!key||!url) return json({error:'Server is not configured'},503)
  if(req.headers.get('authorization')!==`Bearer ${key}`) return json({error:'Trusted webhook authentication required'},401)
  try {
    const {record,table}=await req.json()
    if(table!=='storm_events'||!record?.id) return json({drafted:0,launched:0})
    const db=createClient(url,key)
    const {data,error}=await db.rpc('draft_storm_acquisition_campaigns',{p_storm:record.id})
    if(error) throw error
    return json({drafted:data,launched:0,message:'Drafts await manager review. No advertising spend was activated.'})
  }catch{return json({error:'Unable to prepare storm campaigns',launched:0},500)}
})
