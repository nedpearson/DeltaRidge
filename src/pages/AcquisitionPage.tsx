import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader } from '@/components/ui'
import { useSession } from '@/features/auth/session'
import { getSupabase } from '@/lib/supabase'
import { acquisitionEconomics } from '@/features/acquisition/intake'
interface RequestRow { id: string; lead_id: string; name: string; address: string; phone: string|null; email: string|null; preferred_day: string|null; notes: string|null; status: string; created_at: string; attribution: Record<string,string> }
interface CampaignDraft { id:string;name:string;copy:string;status:string }
interface FollowupRow { id: string; lead_id: string; kind: string; status: string; leads: { properties: { address_line1: string } | null } | null }
interface SpendRow { id: string; source: string; amount_cents: number; spend_date: string; notes: string|null }
const money = (value: number|null) => value === null ? '—' : value.toLocaleString('en-US',{style:'currency',currency:'USD'})
export default function AcquisitionPage() {
  const { membership } = useSession()
  const allowed = membership && ['admin','manager','office'].includes(membership.role)
  const canSpend = membership && ['admin','manager'].includes(membership.role)
  const [requests,setRequests] = useState<RequestRow[]>([])
  const [spend,setSpend] = useState<SpendRow[]>([])
  const [drafts,setDrafts] = useState<CampaignDraft[]>([])
  const [followups,setFollowups] = useState<FollowupRow[]>([])
  const [won,setWon] = useState(0)
  const [booked,setBooked] = useState(0)
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState('')
  const [start,setStart] = useState(new Date(Date.now()-30*86400000).toISOString().slice(0,10))
  const [end,setEnd] = useState(new Date().toISOString().slice(0,10))
  const [times,setTimes] = useState<Record<string,string>>({})
  const [source,setSource] = useState('google')
  const [amount,setAmount] = useState('')
  const [spendDate,setSpendDate] = useState(new Date().toISOString().slice(0,10))
  const [campaign,setCampaign] = useState('')
  const [partner,setPartner] = useState('')
  const [notice,setNotice] = useState('')
  const load = useCallback(async () => {
    if (!allowed || !membership) {setLoading(false);return}
    setLoading(true);setError('')
    try {
      if (start > end) throw new Error('Start date must be before the end date.')
      const db = getSupabase(); if (!db) throw new Error('Server connection is not configured.')
      const after = new Date(`${start}T00:00:00`).toISOString()
      const untilDate = new Date(`${end}T00:00:00`); untilDate.setDate(untilDate.getDate()+1)
      const [r,s,f,d] = await Promise.all([
        db.from('inspection_requests').select('*').eq('organization_id',membership.organizationId).gte('created_at',after).lt('created_at',untilDate.toISOString()).order('created_at',{ascending:false}).limit(1001),
        db.from('acquisition_spend').select('*').eq('organization_id',membership.organizationId).is('deleted_at',null).gte('spend_date',start).lte('spend_date',end).order('spend_date',{ascending:false}).limit(1001),
        db.from('acquisition_followups').select('id,lead_id,kind,status,leads(properties(address_line1))').eq('organization_id',membership.organizationId).eq('status','queued').order('created_at',{ascending:false}).limit(100),
        db.from('acquisition_campaign_drafts').select('id,name,copy,status').eq('organization_id',membership.organizationId).eq('status','draft').order('created_at',{ascending:false}).limit(100)
      ])
      if(r.error) throw r.error; if(s.error) throw s.error; if(f.error) throw f.error; if(d.error) throw d.error
      if ((r.data?.length ?? 0)>1000 || (s.data?.length ?? 0)>1000) throw new Error('Narrow the date range to fewer than 1,000 records for accurate totals.')
      const rows = (r.data ?? []) as RequestRow[]
      const ids = [...new Set(rows.map(row=>row.lead_id))]
      let wonCount=0;let appointmentCount=0
      if(ids.length) {
        const [l,a] = await Promise.all([
          db.from('leads').select('id,status').eq('organization_id',membership.organizationId).in('id',ids).is('deleted_at',null).limit(1001),
          db.from('appointments').select('lead_id').eq('organization_id',membership.organizationId).in('lead_id',ids).in('status',['scheduled','confirmed','completed','no_show']).limit(1001)
        ])
        if(l.error) throw l.error;if(a.error) throw a.error
        if((a.data?.length ?? 0)>1000) throw new Error('Narrow the range to calculate appointment totals.')
        wonCount=(l.data ?? []).filter(row=>row.status==='sold').length
        appointmentCount=new Set((a.data ?? []).map(row=>row.lead_id)).size
      }
      setDrafts((d.data ?? []) as CampaignDraft[]);setFollowups((f.data ?? []) as unknown as FollowupRow[]);setRequests(rows);setSpend((s.data ?? []) as SpendRow[]);setWon(wonCount);setBooked(appointmentCount)
    }catch(err){setError(err instanceof Error ? err.message : (err as {message?:string}).message ?? 'Could not load acquisition data.')}
    finally{setLoading(false)}
  },[allowed,membership,start,end])
  useEffect(()=>{void load()},[load])
  async function confirm(row:RequestRow) {
    if(!times[row.id]) {setError('Choose the appointment date and time first.');return}
    setBusy(row.id);setError('');setNotice('')
    try {
      const db=getSupabase();if(!db) throw new Error('Server connection is not configured.')
      const {data,error:err}=await db.functions.invoke('confirm-inspection-request',{body:{requestId:row.id,start:new Date(times[row.id]!).toISOString()}})
      if(err || !data?.success) throw new Error(data?.error ?? 'Booking failed. Check representative availability and retry.')
      setNotice('Inspection booked and assigned to an available representative. Contact the homeowner to confirm the visit.');await load()
    }catch(err){setError(err instanceof Error ? err.message : 'Booking failed.')}
    finally{setBusy('')}
  }
  async function saveSpend(event:FormEvent) {
    event.preventDefault();if(!membership) return
    const cents=Math.round(Number(amount)*100)
    if(!Number.isFinite(cents)||cents<=0||cents>2147483647) {setError('Enter a positive spend amount.');return}
    setBusy('spend');setError('')
    try {
      const db=getSupabase();if(!db) throw new Error('Server connection is not configured.')
      const {error:err}=await db.from('acquisition_spend').insert({organization_id:membership.organizationId,source:source.trim(),amount_cents:cents,spend_date:spendDate})
      if(err) throw err;setAmount('');await load()
    }catch(err){setError((err as {message?:string}).message ?? 'Unable to save spend.')}
    finally{setBusy('')}
  }
  async function removeSpend(id:string) {
    if(!membership) return
    setBusy(id);setError('')
    const {error:err}=await getSupabase()!.from('acquisition_spend').update({deleted_at:new Date().toISOString()}).eq('id',id).eq('organization_id',membership.organizationId)
    if(err) setError(err.message);else await load();setBusy('')
  }
  async function completeFollowup(id:string) {
    if(!membership) return
    setBusy(id);setError('')
    try {
      const db=getSupabase();if(!db) throw new Error('Server connection is not configured.')
      const {error:err}=await db.from('acquisition_followups').update({status:'completed'}).eq('id',id).eq('organization_id',membership.organizationId)
      if(err) throw err;await load()
    }catch(err){setError((err as {message?:string}).message ?? 'Unable to complete follow-up.')}
    finally{setBusy('')}
  }
  const uniqueLeads = new Set(requests.map(r=>r.lead_id)).size
  const totalSpend = spend.reduce((sum,s)=>sum+s.amount_cents,0)/100
  const metrics = acquisitionEconomics(totalSpend,uniqueLeads,booked,won)
  const campaignUrl = new URL('/free-roof-check',window.location.origin)
  campaignUrl.searchParams.set('utm_source',source.trim() || 'direct');campaignUrl.searchParams.set('utm_medium',partner ? 'referral' : 'campaign')
  if(campaign.trim()) campaignUrl.searchParams.set('utm_campaign',campaign.trim())
  if(partner.trim()) campaignUrl.searchParams.set('ref',partner.trim())
  if(!allowed) return <Card><h1 className="font-bold">Acquisition management</h1><p>Sign in with an owner, manager or office account to review inspection requests.</p><Link to="/more" className="underline">Open account</Link></Card>
  return <div className="space-y-5">
    <PageHeader eyebrow="Growth" title="Inbound acquisition" description="Homeowner requests, confirmed appointments, campaign links and acquisition cost." />
    <Card><div className="flex flex-wrap items-end gap-3"><label>From<input aria-label="From" type="date" value={start} onChange={e=>setStart(e.target.value)} className="block rounded border p-2" /></label><label>Through<input aria-label="Through" type="date" value={end} onChange={e=>setEnd(e.target.value)} className="block rounded border p-2" /></label><button onClick={()=>void load()} className="rounded bg-blue-700 px-4 py-2 text-white">Refresh</button></div><p className="mt-3 text-xs text-text-secondary">Lead cohort: requests received in this range, counted once per property lead. Appointments and wins show their current outcomes. Spend is recorded by spend date; this is blended acquisition cost, not causal campaign attribution. Dates use this device’s timezone.</p></Card>
    {error && <Card><p role="alert" className="text-status-critical">{error}</p></Card>}{notice && <Card><p role="status">{notice}</p></Card>}
    {loading ? <Card>Loading acquisition records…</Card> : !error && <Card><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{[['Unique inbound leads',String(uniqueLeads)],['Leads with appointments',String(booked)],['Signed roofs (sold status)',String(won)],['Recorded spend',money(totalSpend)],['Cost per lead',spend.length ? money(metrics.cpl) : '—'],['Cost per signed roof',spend.length ? money(metrics.cac) : '—']].map(([label,value])=><div key={label}><p className="text-xs text-text-secondary">{label}</p><p className="text-2xl font-bold">{value}</p></div>)}</div><p className="mt-3 text-xs">Costs remain unknown until spend is recorded. Gross profit requires actual job costs; no assumed margin is presented.</p></Card>}
    <Card><h2 className="text-lg font-bold">Inspection requests</h2><p className="mb-4 text-sm text-text-secondary">Confirm the homeowner’s details and a mutually agreed time before booking. New requests do not send automated messages.</p>
      {!loading && !error && !requests.length && <p>No inspection requests in this date range. Share a campaign link after production intake is configured.</p>}
      {!loading && !error && requests.map(row=><article key={row.id} className="border-t border-border-subtle py-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-bold">{row.name} · {row.status}</h3><Link to={`/leads/${row.lead_id}`} className="text-blue-600 underline">Open lead</Link></div><p>{row.address}</p><div className="flex flex-wrap gap-4 py-2">{row.phone && <a href={`tel:${row.phone}`} className="underline">{row.phone}</a>}{row.email && <a href={`mailto:${row.email}`} className="underline">{row.email}</a>}</div><p className="text-sm">Preferred day: {row.preferred_day ?? 'Flexible'} · Source: {row.attribution.utm_source ?? 'Direct'}{row.attribution.ref ? ` · Partner: ${row.attribution.ref}` : ''}</p>{row.notes && <p className="mt-2 text-sm">{row.notes}</p>}{row.status==='requested' && <div className="mt-3 flex flex-wrap gap-3"><label className="text-sm">Agreed time (local)<input type="datetime-local" className="ml-2 rounded border p-2" value={times[row.id]??''} onChange={e=>setTimes(prev=>({...prev,[row.id]:e.target.value}))} /></label><button disabled={!!busy} onClick={()=>void confirm(row)} className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50">{busy===row.id?'Booking…':'Confirm and assign inspection'}</button></div>}</article>)}
    </Card>
    <Card><h2 className="text-lg font-bold">Storm campaign drafts</h2><p className="mt-2 text-sm">Storm webhooks prepare drafts only for organizations with nearby properties and enabled storm campaign settings. Paid activation still requires targeting, creative and provider verification.</p>{drafts.map(draft=><article key={draft.id} className="mt-3 border-t pt-3"><h3 className="font-bold">{draft.name}</h3><p className="mt-2 text-sm">{draft.copy}</p></article>)}{!loading && !error && !drafts.length && <p className="mt-3 text-sm">No storm drafts awaiting review.</p>}</Card>
    <Card><h2 className="text-lg font-bold">Campaign and partner link</h2><div className="mt-3 grid gap-3 sm:grid-cols-3"><label>Source<input value={source} maxLength={200} onChange={e=>setSource(e.target.value)} className="block w-full rounded border p-2" /></label><label>Campaign<input value={campaign} maxLength={200} onChange={e=>setCampaign(e.target.value)} className="block w-full rounded border p-2" /></label><label>Partner code (optional)<input value={partner} maxLength={200} onChange={e=>setPartner(e.target.value)} className="block w-full rounded border p-2" /></label></div><p className="mt-3 break-all text-sm">{campaignUrl.toString()}</p><button className="mt-3 rounded border px-4 py-2" onClick={()=>void navigator.clipboard.writeText(campaignUrl.toString()).then(()=>setNotice('Campaign link copied.')).catch(()=>setError('Clipboard unavailable. Copy the displayed link.'))}>Copy campaign link</button><p className="mt-3 text-xs">Use a public partner code, never private contact details. This creates a tracking link; it does not activate paid advertising.</p></Card>
    {canSpend && <Card><h2 className="text-lg font-bold">Actual acquisition spend</h2><form onSubmit={saveSpend} className="mt-3 flex flex-wrap items-end gap-3"><label>Amount ($)<input type="number" min="0.01" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} className="block rounded border p-2" /></label><label>Date<input type="date" required value={spendDate} onChange={e=>setSpendDate(e.target.value)} className="block rounded border p-2" /></label><button disabled={!!busy || !source.trim()} className="rounded bg-blue-700 px-4 py-2 text-white">Record spend for {source || 'source'}</button></form><ul className="mt-3 space-y-2">{spend.map(row=><li key={row.id} className="flex flex-wrap justify-between gap-2"><span>{row.spend_date} · {row.source} · {money(row.amount_cents/100)}</span><button disabled={!!busy} onClick={()=>void removeSpend(row.id)} className="underline">Remove from totals</button></li>)}</ul></Card>}
    <Card><h2 className="font-bold">Review and referral follow-up</h2><p className="mt-2 text-sm">Tasks queue when a lead becomes sold. Verify the job is completed before requesting honest customer feedback. No message has been sent automatically.</p>{followups.map(row=><div key={row.id} className="mt-3 flex flex-wrap justify-between gap-3 border-t pt-3"><Link className="underline" to={`/leads/${row.lead_id}`}>{row.kind === 'review' ? 'Request honest review' : 'Discuss referrals'} · {row.leads?.properties?.address_line1 ?? 'Open customer lead'}</Link><button className="underline" disabled={!!busy} onClick={()=>void completeFollowup(row.id)}>Mark follow-up completed</button></div>)}{!loading && !error && !followups.length && <p className="mt-3 text-sm">No queued follow-up tasks.</p>}</Card>
    <Card><h2 className="font-bold">Owner demonstration</h2><p className="mt-2 text-sm">Share link → homeowner requests inspection → manager confirms and assigns → existing inspection, EagleView, proposal and sold workflow. Provider integrations and paid campaigns need separate live verification.</p><div className="mt-3 flex flex-wrap gap-4"><Link to="/free-roof-check" className="underline">Open homeowner intake</Link><Link to="/manager" className="underline">Manager dashboard</Link><Link to="/settings" className="underline">Integration settings</Link></div></Card>
  </div>
}
