import { useEffect, useState } from 'react'
import { Button, Card } from '@/components/ui'
import { getSupabase } from '@/lib/supabase'
import { useSession } from '@/features/auth/session'
function keyBytes(value: string): ArrayBuffer {
 const encoded = value.replace(/-/g,'+').replace(/_/g,'/')
 const raw = atob(encoded + '='.repeat((4-encoded.length%4)%4))
 return Uint8Array.from(raw,c=>c.charCodeAt(0)).buffer
}
export default function PushSettings() {
 const { session, membership } = useSession()
 const [enabled,setEnabled] = useState(false)
 const [busy,setBusy] = useState(false)
 const [notice,setNotice] = useState('')
 const supported = typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window
 useEffect(()=>{ if (supported) void navigator.serviceWorker.getRegistration().then(r=>r?.pushManager.getSubscription()).then(s=>setEnabled(Boolean(s))) },[supported])
 async function enable() {
  const supabase=getSupabase(); const org=membership?.organizationId
  if (!supabase || !session || !org) { setNotice('Sign in with your company account first.'); return }
  setBusy(true);setNotice('')
  try {
   const { data,error } = await supabase.functions.invoke('push-notifications',{body:{action:'config',organizationId:org}})
   if(error || !data?.publicKey) throw new Error('Push delivery is not deployed or its server keys are missing.')
   if(await Notification.requestPermission()!=='granted') throw new Error('Allow notifications in your browser settings to enable alerts.')
   const registration=await navigator.serviceWorker.getRegistration()
   if(!registration?.active) throw new Error('Reload the app to activate its notification service.')
   const subscription=await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:keyBytes(data.publicKey)})
   const saved=await supabase.functions.invoke('push-notifications',{body:{action:'subscribe',organizationId:org,subscription:subscription.toJSON()}})
   if(saved.error || !saved.data?.ok) throw new Error('Could not register this device. Try again.')
   setEnabled(true);setNotice('This device is registered. The delivery worker sends new alerts when they arrive.')
  } catch(error) {setNotice(error instanceof Error?error.message:'Could not enable notifications.')} finally {setBusy(false)}
 }
 async function test() {
  const supabase=getSupabase();if(!supabase || !membership)return
  setBusy(true)
  try {
   const {data,error}=await supabase.functions.invoke('push-notifications',{body:{action:'test',organizationId:membership.organizationId}})
   setNotice(error || !data?.ok ? data?.error ?? 'Could not queue the test alert.' : 'Test queued for your account. The delivery worker runs about every ten minutes.')
  } finally {setBusy(false)}
 }
 async function disable() {
  setBusy(true)
  try {
   const registration=await navigator.serviceWorker.getRegistration();const subscription=await registration?.pushManager.getSubscription()
   if(subscription) {
    const supabase=getSupabase(); if(!supabase) throw new Error('Sign in first.')
    const {error}=await supabase.from('push_subscriptions').delete().eq('endpoint',subscription.endpoint)
    if(error) throw new Error('Could not unregister this device.')
    await subscription.unsubscribe()
   }
   setEnabled(false);setNotice('Notifications disabled on this device.')
  } catch(error) {setNotice(error instanceof Error?error.message:'Could not disable notifications.')} finally {setBusy(false)}
 }
 return <Card className="p-5"><h3 className="font-bold">Alerts on this device</h3><p className="mt-2 text-sm text-text-secondary">{supported?'Register this device to receive new lead, assignment and storm alerts while the app is closed.':'This browser does not support push. On iPhone, add the app to your Home Screen and open it there.'}</p>
 <Button className="mt-3" disabled={!supported||busy||!session} onClick={()=>void(enabled?disable():enable())}>{busy?'Updating…':enabled?'Disable device alerts':'Enable device alerts'}</Button>
 {enabled&&<Button className="mt-3 ml-2" disabled={busy||!session} onClick={()=>void test()}>Send test alert</Button>}
 {notice&&<p role="status" className="mt-2 text-sm text-text-secondary">{notice}</p>}</Card>
}
