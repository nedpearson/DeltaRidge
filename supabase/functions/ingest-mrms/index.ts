/** The scheduled Python worker performs ingestion; this endpoint verifies its latest import. */
import { createClient } from 'npm:@supabase/supabase-js@2'
Deno.serve(async(req:Request)=>{
 const secret=Deno.env.get('CRON_SECRET')
 if(!secret || req.headers.get('Authorization')!=='Bearer '+secret) return new Response('Unauthorized',{status:401})
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
 const {data,error}=await db.from('mrms_grids').select('observed_at,imported_at,valid_cell_count,missing_cell_count').order('observed_at',{ascending:false}).limit(1).maybeSingle()
 const fresh=data && Date.now()-Date.parse(data.observed_at)<=2*3600000
 return new Response(JSON.stringify(error||!fresh?{success:false,message:'No current decoded grid is available. Run the MRMS integration worker.'}:{success:true,...data}),{status:error||!fresh?503:200,headers:{'content-type':'application/json'}})
})
