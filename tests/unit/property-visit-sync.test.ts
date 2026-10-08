import { expect,it,vi,beforeEach } from 'vitest'
import { pushPropertyVisit } from '@/lib/sync/visits'
const f=vi.hoisted(()=>({put:vi.fn(),upsert:vi.fn(),read:vi.fn(),lead:vi.fn()}))
vi.mock('@/lib/db',()=>({getDB:async()=>({get:f.read,put:f.put})}))
vi.mock('@/lib/sync-store',()=>({getRemoteId:async()=>'remote-lead'}))
vi.mock('@/lib/sync/leads',()=>({pushLead:vi.fn()}))
vi.mock('@/lib/sync/routes',()=>({pushRouteSession:vi.fn()}))
vi.mock('@/lib/supabase',()=>({getSupabase:()=>({from:(table:string)=>table==='property_visits'?{upsert:f.upsert}:{select:()=>({eq:()=>({eq:()=>({single:f.lead})})})}})}))
beforeEach(()=>{vi.clearAllMocks();f.read.mockResolvedValue({id:'visit',leadId:'lead',gpsVerified:true,reportedAction:'knocked',visitedAt:'2026-10-08T00:00:00Z',syncState:'queued'});f.lead.mockResolvedValue({data:{property_id:'property'},error:null});f.upsert.mockResolvedValue({error:null})})
it('sends visits with their property and leaves a synced local copy only after acknowledgement',async()=>{
 await pushPropertyVisit('visit','org','rep')
 expect(f.upsert).toHaveBeenCalledWith(expect.objectContaining({id:'visit',property_id:'property',user_id:'rep',organization_id:'org'}),{onConflict:'id'})
 expect(f.put).toHaveBeenCalledWith('propertyVisits',expect.objectContaining({syncState:'synced'}))
})
it('does not mark a visit synced when the server refuses it',async()=>{
 f.upsert.mockResolvedValue({error:{message:'permission denied'}})
 await expect(pushPropertyVisit('visit','org','rep')).rejects.toThrow('permission denied')
 expect(f.put).not.toHaveBeenCalled()
})
