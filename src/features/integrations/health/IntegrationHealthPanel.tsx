import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, SectionTitle } from '@/components/ui'
import { ago } from '@/features/manager/tabs/shared'
import { getSupabase } from '@/lib/supabase'
import { pendingWork, syncOutbox } from '@/lib/sync'
import { retryStalledOutbox } from '@/lib/sync-store'
import { readSyncTraffic } from '@/lib/sync/meta'
import { useSession } from '@/features/auth/session'
import { assessHealth, needsAttention, worstFirst, type Health, type HealthState } from './health'

const TONE: Record<HealthState, { dot: string; word: string }> = {
 unknown: { dot: 'bg-status-warning', word: 'Unable to verify' },
 down: { dot: 'bg-status-critical', word: 'Down' }, degraded: { dot: 'bg-status-warning', word: 'Unreliable' },
 stale: { dot: 'bg-status-warning', word: 'Gone quiet' }, never_used: { dot: 'bg-bg-elevated', word: 'Unproven' },
 healthy: { dot: 'bg-status-success', word: 'Working' }, not_configured: { dot: 'bg-bg-elevated', word: 'Not set up' },
}
interface Row { key: string; label: string; detail: string; health: Health; action: string; to: string }
type TrafficRow = { status: string; created_at?: string; received_at?: string; requested_at?: string; completed_at?: string; acknowledged_at?: string; response_count?: number | null; action?: string }
type Run = { integration: string; status: string; detail: string; created_at: string }
interface Status { configured: { contacts: boolean; push: boolean; roofr: boolean }; runs: Run[] }
const unknown = (summary: string): Health => ({ state: 'unknown', summary, successes: 0, failures: 0, lastSuccessAt: null, lastFailureAt: null })
function traffic(rows: TrafficRow[], configured: boolean, good: string[], bad: string[], expectedWithinHours: number | null = null): Health {
 const successes = rows.filter(r => good.includes(r.status))
 const failures = rows.filter(r => bad.includes(r.status))
 const stamp = (r?: TrafficRow) => r?.completed_at ?? r?.acknowledged_at ?? r?.received_at ?? r?.created_at ?? null
 return assessHealth({ configured, successes: successes.length, failures: failures.length, lastSuccessAt: stamp(successes[0]), lastFailureAt: stamp(failures[0]), expectedWithinHours })
}

export default function HealthTab({ organizationId }: { organizationId: string | null }) {
 const { session } = useSession()
 const [rows, setRows] = useState<Row[]>([])
 const [loading, setLoading] = useState(true)
 const [retrying, setRetrying] = useState(false)
 const load = useCallback(async () => {
  setLoading(true)
  const built: Row[] = []
  const add = (key: string, label: string, detail: string, health: Health, tab = 'integrations', action = 'Open setup') => built.push({ key,label,detail,health,to: `/settings?tab=${tab}`,action })
  const supabase = getSupabase()
  const signedIn = Boolean(session && organizationId && supabase)
  try {
   const work = await pendingWork(session?.user.id ?? null)
   const measured = readSyncTraffic(`${organizationId}:${session?.user.id}`)
   let health = assessHealth({ configured: Boolean(supabase), ...measured, expectedWithinHours: null })
   if (!signedIn) health = unknown('Sign in with your company account to send saved field work.')
   else if (work.stalled || work.blocked) health = { ...health, state: 'down', summary: `${work.stalled} stopped retrying; ${work.blocked} need a renewed sign-in. Saved work remains on this device.` }
   else if (work.total) health = { ...health, summary: `${work.total} updates waiting for server acknowledgement. ${work.foreign} belong to another sign-in.` }
   add('sync','Field sync','This device to the server',health,'field','View sync settings')
  } catch { add('sync','Field sync','This device to the server',unknown('Cannot read the saved-work queue. Open diagnostics before changing this device.'),'field','View sync settings') }
  if (!signedIn || !supabase || !organizationId) {
   for (const [key,label,detail,tab] of [
    ['supabase','Supabase','Database and Auth','account'], ['eagleview','EagleView','Imagery discovery and full-resolution images','integrations'],
    ['roofr_in','Roofr → Delta Ridge','Events arriving through Zapier','integrations'], ['roofr_out','Delta Ridge → Roofr','Jobs confirmed by Roofr','integrations'],
    ['mrms','NOAA MRMS grids','Decoded 24-hour radar hail grids','storms'], ['contacts','Contact Providers','Server-side homeowner contact lookups','contacts'],
    ['notifications','Notifications','Push notification delivery','notifications'],
   ]) add(key!,label!,detail!,unknown('Sign in to verify this organization’s integrations.'),tab,'Sign in and check')
  } else {
   const since = new Date(Date.now()-7*86400000).toISOString()
   try {
    const [auth, settings, events, outbox, imagery, status] = await Promise.all([
     supabase.auth.getUser(),
     supabase.from('roofr_settings').select('push_enabled,webhook_secret_hash').eq('organization_id',organizationId).maybeSingle(),
     supabase.from('roofr_events').select('status,received_at').eq('organization_id',organizationId).gte('received_at',since).order('received_at',{ascending:false}).limit(200),
     supabase.from('roofr_outbox').select('status,created_at,acknowledged_at').eq('organization_id',organizationId).gte('created_at',since).order('created_at',{ascending:false}).limit(200),
     supabase.from('imagery_requests').select('status,action,response_count,completed_at,requested_at').eq('organization_id',organizationId).eq('provider','eagleview').gte('requested_at',since).order('requested_at',{ascending:false}).limit(200),
     supabase.functions.invoke<Status>('integration-status',{ body: { organizationId } }),
    ])
    add('supabase','Supabase','Live Auth verification and database read',auth.error || !auth.data.user || settings.error ? unknown('Auth or database verification failed. Check your sign-in and backend deployment.') : assessHealth({ configured: true, successes: 1, failures: 0, lastSuccessAt: new Date().toISOString(), lastFailureAt: null, expectedWithinHours: null }),'account','Open account')
    add('roofr_in','Roofr → Delta Ridge','Events arriving through Zapier',settings.error || events.error ? unknown('Cannot read webhook settings or event receipts. Deploy the Roofr schema and check organization access.') : traffic(events.data ?? [],Boolean(settings.data?.webhook_secret_hash),['processed','ignored'],['failed']))
    let roofrOut = settings.error || outbox.error ? unknown('Cannot read outbound jobs. Deploy the Roofr schema and check organization access.') : traffic(outbox.data ?? [],settings.data?.push_enabled === true,['acknowledged'],['failed','given_up'])
    if (!status.error && status.data && !status.data.configured.roofr) roofrOut = { ...roofrOut,state:'not_configured',summary:'The server needs a Zapier webhook connected to Roofr’s create-job action.' }
    const awaiting = (outbox.data ?? []).filter(r=>r.status==='sent' || r.status==='queued').length
    add('roofr_out','Delta Ridge → Roofr',`Jobs confirmed by Roofr${awaiting ? `; ${awaiting} awaiting confirmation` : ''}`,roofrOut)
    const images = (imagery.data ?? []) as TrafficRow[]
    // A successful discovery with zero captures is not usable imagery.
    const usable = images.map(r=>({ ...r, status:r.status==='succeeded' && !r.response_count ? 'empty' : r.status }))
    add('eagleview','EagleView','Imagery discovery and full-resolution images',imagery.error ? unknown('Cannot read imagery receipts. Check the imagery backend deployment.') : traffic(usable,images.some(r=>r.status!=='not_configured'),['succeeded'],['failed','empty']))
    for (const [key,label,detail,tab] of [['contacts','Contact Providers','Server-side homeowner contact lookups','contacts'],['mrms','NOAA MRMS grids','Decoded 24-hour radar hail grids','storms'],['push','Notifications','Push-service delivery receipts; device permission is required','notifications']] as const) {
     if (status.error || !status.data) add(key,label,detail,unknown('Integration monitoring backend is unavailable. Deploy integration-status and its database migration.'),tab)
     else {
      const runs = status.data.runs.filter(r=>r.integration===key)
      const configured = key==='mrms' ? runs.some(r=>r.status!=='not_configured') : status.data.configured[key]
      const health = traffic(runs,configured,['success'],['failed'],key==='mrms'?2:null)
      add(key,label,detail,key==='mrms' && runs[0]?.detail.startsWith('Grid imported: 0 valid cells') ? unknown('The grid was imported, but NOAA reports missing radar data in this territory.') : runs[0]?.status==='failed' ? { ...health, summary: `${health.summary} ${runs[0].detail}` } : health,tab)
     }
    }
   } catch {
    for (const [key,label] of [['supabase','Supabase'],['roofr_in','Roofr → Delta Ridge'],['roofr_out','Delta Ridge → Roofr'],['eagleview','EagleView'],['contacts','Contact Providers'],['mrms','NOAA MRMS grids'],['push','Notifications']]) add(key!,label!,'',unknown('The integration check could not complete. Check connectivity and refresh.'))
   }
  }
  setRows(worstFirst(built)); setLoading(false)
 },[organizationId,session])
 useEffect(()=>{ void load() },[load])
 const retry = async () => {
  if (!organizationId || !session) return
  setRetrying(true)
  try { await retryStalledOutbox(); await syncOutbox(organizationId,session.user.id) } finally { setRetrying(false); await load() }
 }
 const attention = needsAttention(rows) + rows.filter(r=>r.health.state==='unknown'||r.health.state==='not_configured'||r.health.state==='never_used').length
 return <Card>
  <SectionTitle hint="Working means a completed request, usable imagery, imported grid, confirmed CRM job, or push-service receipt. Recent traffic: seven days.">INTEGRATION HEALTH</SectionTitle>
  {loading ? <p role="status" className="mt-3 text-sm text-text-secondary">Checking live services…</p> : <>
   <p className="mt-2 text-sm text-text-secondary">{attention ? `${attention} need setup or attention` : 'All integrations have verified traffic'}</p>
   <ul className="mt-3 space-y-4">{rows.map(row=><li key={row.key} className="flex gap-3">
    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TONE[row.health.state].dot}`} aria-hidden="true" />
    <div className="min-w-0 flex-1"><div className="flex flex-wrap justify-between gap-x-3"><span className="text-sm">{row.label}</span><span className="text-xs text-text-secondary">{TONE[row.health.state].word}</span></div>
     <p className="text-xs text-text-secondary">{row.health.summary}</p><p className="text-xs text-text-secondary">{row.detail}</p>
     {row.health.lastSuccessAt && <p className="text-xs text-text-secondary">Last success {ago(row.health.lastSuccessAt)}</p>}
     {row.health.lastFailureAt && <p className="text-xs text-text-secondary">Last failure {ago(row.health.lastFailureAt)}</p>}
     <div className="mt-2 flex flex-wrap gap-3"><button type="button" onClick={()=>void load()} className="text-xs underline">Refresh status</button><Link to={row.to} className="text-xs underline">{row.action}</Link>
      {row.key==='sync' && session && organizationId && <button type="button" disabled={retrying} onClick={()=>void retry()} className="text-xs underline">{retrying?'Syncing…':'Retry saved work'}</button>}
     </div>
    </div></li>)}</ul>
  </>}
 </Card>
}
