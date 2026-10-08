import { beforeEach, expect, it, vi } from 'vitest'
import { render,screen,waitFor,cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import HealthTab from '@/features/integrations/health/IntegrationHealthPanel'
import { readSyncTraffic,recordSyncTraffic } from '@/lib/sync/meta'
import { imageryRequest } from '../../supabase/functions/_shared/imagery-retry'
const fixtures=vi.hoisted(()=>({ session:null as null|{user:{id:string}}, calls:[] as string[] }))
vi.mock('@/features/auth/session',()=>({useSession:()=>({session:fixtures.session})}))
vi.mock('@/lib/sync',()=>({pendingWork:async()=>({total:2,stalled:0,blocked:0,foreign:0}),syncOutbox:vi.fn()}))
vi.mock('@/lib/sync-store',()=>({retryStalledOutbox:vi.fn()}))
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({
 auth:{getUser:async()=>({data:{user:{id:'rep'}},error:null})},
 from:(table:string)=>{
  fixtures.calls.push(table)
  const result=table==='imagery_requests'?{data:[{status:'succeeded',response_count:0,completed_at:new Date().toISOString()}],error:null}:table==='roofr_settings'?{data:{push_enabled:true,webhook_secret_hash:'configured'},error:null}:table==='roofr_outbox'?{data:null,error:{message:'permission denied'}}:{data:[],error:null}
  const query:{select:()=>unknown;eq:()=>unknown;gte:()=>unknown;order:()=>unknown;limit:()=>Promise<typeof result>;maybeSingle:()=>Promise<typeof result>}={select:()=>query,eq:()=>query,gte:()=>query,order:()=>query,limit:async()=>result,maybeSingle:async()=>result}
  return query
 },
 functions:{invoke:async()=>({data:null,error:{message:'not deployed'}})},
})}))
beforeEach(()=>{cleanup();window.localStorage.clear();fixtures.session=null;fixtures.calls=[]})
it('does not treat queued work or a Supabase client as successful traffic',async()=>{
 render(<MemoryRouter><HealthTab organizationId={null}/></MemoryRouter>)
 await waitFor(()=>expect(screen.queryByText('Checking live services…')).toBeNull())
 expect(screen.getAllByText('Unable to verify')).toHaveLength(8)
 expect(screen.queryByText('Working')).toBeNull()
 expect(fixtures.calls).toHaveLength(0)
})
it('keeps query failures unknown and rejects empty discovery as usable imagery',async()=>{
 fixtures.session={user:{id:'rep'}}
 render(<MemoryRouter><HealthTab organizationId="org"/></MemoryRouter>)
 await waitFor(()=>expect(screen.queryByText('Checking live services…')).toBeNull())
 expect(screen.getByText('Cannot read outbound jobs. Deploy the Roofr schema and check organization access.')).toBeTruthy()
 expect(screen.getByText(/1 attempts, none worked/)).toBeTruthy()
 expect(screen.getAllByText('Integration monitoring backend is unavailable. Deploy integration-status and its database migration.')).toHaveLength(3)
})
it('records only acknowledged field writes, scoped to the signed-in user',()=>{
 recordSyncTraffic('org:alice',0,0)
 expect(readSyncTraffic('org:alice').successes).toBe(0)
 recordSyncTraffic('org:alice',2,1,'2026-10-08T00:00:00Z')
 expect(readSyncTraffic('org:alice')).toMatchObject({successes:2,failures:1,lastSuccessAt:'2026-10-08T00:00:00Z'})
 expect(readSyncTraffic('org:bob').successes).toBe(0)
})
it('retries a transient read failure and refreshes once on expired imagery auth',async()=>{
 const request=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(new Response('image',{status:200}))
 const response=await imageryRequest(request,async()=>{})
 expect(response.status).toBe(200)
 expect(request.mock.calls.map(call=>call[0])).toEqual([false,false,true])
})
it('does not retry an entitlement refusal',async()=>{
 const request=vi.fn().mockResolvedValue(new Response('',{status:403}))
 expect((await imageryRequest(request,async()=>{})).status).toBe(403)
 expect(request).toHaveBeenCalledTimes(1)
})
