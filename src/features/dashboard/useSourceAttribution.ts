import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'

export interface SourceData { name: string; appts: number; closeRate: string; revenue: string; gp: string; gpPerOpp: string }
export function useSourceAttribution() {
  const { membership } = useSession()
  const [data,setData] = useState<SourceData[]|null>(null)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState<string|null>(null)
  useEffect(()=>{
    let active=true
    async function load() {
      setLoading(true);setError(null)
      try {
        const db=getSupabase()
        if(!db || !membership) throw new Error('Sign in to read source attribution.')
        const org=membership.organizationId
        const [s,l,a] = await Promise.all([
          db.from('lead_sources').select('id,name').eq('organization_id',org).limit(1001),
          db.from('leads').select('id,lead_source_id,status,roofr_links(proposal_total_cents)').eq('organization_id',org).is('deleted_at',null).limit(1001),
          db.from('appointments').select('lead_id').eq('organization_id',org).in('status',['scheduled','confirmed','completed','no_show']).limit(1001)
        ])
        if(s.error) throw s.error;if(l.error) throw l.error;if(a.error) throw a.error
        if([s.data,l.data,a.data].some(rows=>(rows?.length??0)>1000)) throw new Error('Source attribution exceeds 1,000 records. Use the dated Acquisition report.')
        const appointments=new Set((a.data??[]).map(row=>row.lead_id))
        const sources=new Map((s.data??[]).map(row=>[row.id,row.name]))
        const totals=new Map<string,{name:string;opps:number;appts:number;won:number;rev:number;knownRevenue:boolean}>()
        for(const lead of l.data??[]) {
          const id=lead.lead_source_id??'unattributed'
          const stats=totals.get(id)??{name:sources.get(id)??'Other / Unattributed',opps:0,appts:0,won:0,rev:0,knownRevenue:true}
          stats.opps++;if(appointments.has(lead.id)) stats.appts++
          if(lead.status==='sold') {
            stats.won++
            const links=lead.roofr_links??[]
            // Multiple proposal versions cannot be summed as separate sales.
            if(links.length===1 && links[0]?.proposal_total_cents!=null) stats.rev+=links[0].proposal_total_cents/100
            else stats.knownRevenue=false
          }
          totals.set(id,stats)
        }
        const result=[...totals.values()].map(row=>({name:row.name,appts:row.appts,
          closeRate:row.opps ? `${Math.round(row.won/row.opps*100)}%` : '—',
          revenue:row.knownRevenue ? row.rev.toLocaleString('en-US',{style:'currency',currency:'USD'}) : 'Unverified',
          gp:'Not measured',gpPerOpp:'Not measured'}))
        if(active) setData(result)
      }catch(err){if(active){setData(null);setError((err as {message?:string}).message??'Could not load source attribution.')}}
      finally{if(active) setLoading(false)}
    }
    void load();return()=>{active=false}
  },[membership])
  return {data,loading,error}
}
